/**
 * Maintenance bill notify + payment receipt email/PDF (node:test).
 * 360° coverage: categories, methods, penalty, email happy/edge paths,
 * bill-create push (maintenance / water / special × uniform / flat_wise / targeted),
 * approvePayment + easebuzzCallback → notify + receipt email, downloadReceipt.
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const SUPABASE_PATH = require.resolve('../src/supabase');
const MAIL_PATH = require.resolve('../src/utils/mailService');
const RECEIPT_PATH = require.resolve('../src/utils/maintenanceReceiptPdf');
const NS_PATH = require.resolve('../src/utils/notificationService');
const EXPENSE_PATH = require.resolve('../src/utils/addMaintenanceExpense');
const ACTIVITY_PATH = require.resolve('../src/utils/activityLogger');
const IMAGE_PATH = require.resolve('../src/utils/imageUploadHelper');
const EASEBUZZ_PATH = require.resolve('../src/utils/easebuzzHelper');
const CONTROLLER_PATH = require.resolve('../src/controllers/maintenanceController');

const PDF_MAGIC = Buffer.from('%PDF');

function samplePaidRecord(overrides = {}) {
  return {
    id: 'pay-abcd1234-5678-90ab-cdef-111111111111',
    user_id: 'user-1',
    building_id: 'bldg-1',
    status: 'paid',
    amount: 1500,
    penalty_amount: 0,
    total_amount: 1500,
    payment_method: 'online_easebuzz',
    paid_at: '2026-04-01T10:00:00.000Z',
    razorpay_payment_id: 'EBZ123',
    maintenance_bills: {
      month: 4,
      year: 2026,
      amount: 1500,
      due_date: '2026-04-10',
      description: 'Monthly maintenance',
      category: 'maintenance',
      penalty_amount: 0,
    },
    users: {
      name: 'Ravi Patel',
      flat_no: 'A-101',
      email: 'ravi@example.com',
      phone: '9876543210',
    },
    buildings: {
      name: 'Green Heights',
      address: 'Ahmedabad',
    },
    ...overrides,
  };
}

function clearModule(path) {
  delete require.cache[path];
}

function mockModule(path, exports) {
  require.cache[path] = {
    id: path,
    filename: path,
    loaded: true,
    exports,
  };
}

function loadReceiptUtils({ paymentRecord = null, sendMailImpl } = {}) {
  clearModule(SUPABASE_PATH);
  clearModule(MAIL_PATH);
  clearModule(RECEIPT_PATH);

  mockModule(SUPABASE_PATH, {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async single() {
          if (!paymentRecord) {
            return { data: null, error: { message: 'not found' } };
          }
          return { data: paymentRecord, error: null };
        },
      };
    },
  });

  const realMail = require('../src/utils/mailService');
  mockModule(MAIL_PATH, {
    sendMail: sendMailImpl || (async () => ({ messageId: 'test' })),
    escapeHtml: realMail.escapeHtml,
    notifyOps: async () => {},
  });

  return require('../src/utils/maintenanceReceiptPdf');
}

describe('methodLabelFromRecord / categoryLabelFromBill', () => {
  /** @type {any} */
  let utils;

  beforeEach(() => {
    utils = loadReceiptUtils();
  });

  it('maps online / easebuzz / cheque / cash / unknown', () => {
    assert.equal(utils.methodLabelFromRecord({ payment_method: 'online_easebuzz' }), 'Online (Easebuzz)');
    assert.equal(utils.methodLabelFromRecord({ payment_method: 'easebuzz' }), 'Online (Easebuzz)');
    assert.equal(utils.methodLabelFromRecord({ payment_method: 'online' }), 'Online (Easebuzz)');
    assert.equal(utils.methodLabelFromRecord({ payment_method: 'cheque' }), 'Cheque');
    assert.equal(utils.methodLabelFromRecord({ payment_method: 'cash' }), 'Cash');
    assert.equal(utils.methodLabelFromRecord({ payment_method: 'something_else' }), 'Manual');
    assert.equal(utils.methodLabelFromRecord({}), 'Manual');
  });

  it('maps bill categories to receipt titles', () => {
    assert.match(utils.categoryLabelFromBill({ category: 'maintenance' }), /Maintenance/i);
    assert.match(utils.categoryLabelFromBill({ category: 'water_meter' }), /Water/i);
    assert.match(utils.categoryLabelFromBill({ category: 'special' }), /Special/i);
    assert.match(utils.categoryLabelFromBill({}), /Payment Receipt/i);
  });
});

describe('buildReceiptPdfBuffer — categories & amounts', () => {
  /** @type {any} */
  let utils;

  beforeEach(() => {
    utils = loadReceiptUtils();
  });

  it('builds a PDF for maintenance (online)', async () => {
    const buf = await utils.buildReceiptPdfBuffer(samplePaidRecord());
    assert.ok(Buffer.isBuffer(buf));
    assert.ok(buf.length > 500);
    assert.equal(buf.subarray(0, 4).equals(PDF_MAGIC), true);
  });

  it('builds a PDF for water_meter cash with penalty line', async () => {
    const buf = await utils.buildReceiptPdfBuffer(samplePaidRecord({
      payment_method: 'cash',
      amount: 400,
      penalty_amount: 50,
      total_amount: 450,
      maintenance_bills: {
        month: 5,
        year: 2026,
        amount: 400,
        due_date: '2026-05-05',
        description: 'Water Meter Bill',
        category: 'water_meter',
        penalty_amount: 0,
      },
    }));
    assert.ok(buf.subarray(0, 4).equals(PDF_MAGIC));
    assert.ok(buf.length > 500);
  });

  it('builds a PDF for cash without optional reference', async () => {
    const buf = await utils.buildReceiptPdfBuffer(samplePaidRecord({
      payment_method: 'cash',
      razorpay_payment_id: null,
      penalty_amount: 0,
      total_amount: 1500,
    }));
    assert.ok(buf.subarray(0, 4).equals(PDF_MAGIC));
  });

  it('builds a PDF for special cheque bill', async () => {
    const buf = await utils.buildReceiptPdfBuffer(samplePaidRecord({
      payment_method: 'cheque',
      maintenance_bills: {
        month: null,
        year: null,
        amount: 2000,
        due_date: '2026-06-01',
        description: 'Festival decoration',
        category: 'special',
        penalty_amount: 0,
      },
    }));
    assert.ok(buf.subarray(0, 4).equals(PDF_MAGIC));
  });
});

describe('sendPaymentReceiptEmail — happy path & guards', () => {
  const mailCalls = [];

  afterEach(() => {
    mailCalls.length = 0;
    process.env.MAIL_USER = process.env.MAIL_USER || 'test@example.com';
    process.env.MAIL_PASS = process.env.MAIL_PASS || 'test-pass';
  });

  it('emails PDF attachment when payment is paid and user has email', async () => {
    process.env.MAIL_USER = 'test@example.com';
    process.env.MAIL_PASS = 'test-pass';
    const record = samplePaidRecord();
    const utils = loadReceiptUtils({
      paymentRecord: record,
      sendMailImpl: async (opts) => {
        mailCalls.push(opts);
        return { messageId: 'm1' };
      },
    });

    await utils.sendPaymentReceiptEmail(record.id);

    assert.equal(mailCalls.length, 1);
    const mail = mailCalls[0];
    assert.equal(mail.to, 'ravi@example.com');
    assert.match(mail.subject, /Payment Receipt/);
    assert.match(mail.subject, /Green Heights/);
    assert.ok(Array.isArray(mail.attachments));
    assert.equal(mail.attachments.length, 1);
    assert.match(mail.attachments[0].filename, /^receipt_.*\.pdf$/);
    assert.equal(mail.attachments[0].contentType, 'application/pdf');
    assert.ok(Buffer.isBuffer(mail.attachments[0].content));
    assert.ok(mail.attachments[0].content.subarray(0, 4).equals(PDF_MAGIC));
    assert.match(mail.html, /1,500|1500/);
  });

  it('skips email when payment is not paid', async () => {
    const utils = loadReceiptUtils({
      paymentRecord: samplePaidRecord({ status: 'pending' }),
      sendMailImpl: async (opts) => {
        mailCalls.push(opts);
      },
    });
    await utils.sendPaymentReceiptEmail('pay-1');
    assert.equal(mailCalls.length, 0);
  });

  it('skips email when resident has no email', async () => {
    const utils = loadReceiptUtils({
      paymentRecord: samplePaidRecord({
        users: { name: 'No Mail', flat_no: 'B-1', email: null, phone: null },
      }),
      sendMailImpl: async (opts) => {
        mailCalls.push(opts);
      },
    });
    await utils.sendPaymentReceiptEmail('pay-1');
    assert.equal(mailCalls.length, 0);
  });

  it('skips when payment id missing or record not found', async () => {
    const utils = loadReceiptUtils({
      paymentRecord: null,
      sendMailImpl: async (opts) => {
        mailCalls.push(opts);
      },
    });
    await utils.sendPaymentReceiptEmail(null);
    await utils.sendPaymentReceiptEmail('missing-id');
    assert.equal(mailCalls.length, 0);
  });

  it('never throws when sendMail fails', async () => {
    process.env.MAIL_USER = 'test@example.com';
    process.env.MAIL_PASS = 'test-pass';
    const utils = loadReceiptUtils({
      paymentRecord: samplePaidRecord(),
      sendMailImpl: async () => {
        throw new Error('SMTP down');
      },
    });
    await assert.doesNotReject(() => utils.sendPaymentReceiptEmail(samplePaidRecord().id));
  });

  it('emails receipt for cash and cheque methods', async () => {
    process.env.MAIL_USER = 'test@example.com';
    process.env.MAIL_PASS = 'test-pass';
    for (const method of ['cash', 'cheque']) {
      /** @type {any} */
      let lastMail;
      const utils = loadReceiptUtils({
        paymentRecord: samplePaidRecord({
          id: `pay-${method}`,
          payment_method: method,
          razorpay_payment_id: `MANUAL_${method.toUpperCase()}_1`,
        }),
        sendMailImpl: async (opts) => {
          lastMail = opts;
          return { messageId: 'ok' };
        },
      });
      await utils.sendPaymentReceiptEmail(`pay-${method}`);
      assert.ok(lastMail);
      assert.match(lastMail.subject, /Payment Receipt/i);
      assert.equal(lastMail.attachments[0].contentType, 'application/pdf');
      assert.match(lastMail.text, new RegExp(method === 'cash' ? 'Cash' : 'Cheque', 'i'));
    }
  });
});

describe('maintenanceController — bill create notify + approve / easebuzz receipt email', () => {
  /** @type {any[]} */
  let notifyCalls = [];
  /** @type {any[]} */
  let receiptEmailCalls = [];
  /** @type {any[]} */
  let activityCalls = [];
  /** @type {Record<string, any[]>} */
  let tables = {};
  /** @type {'success' | 'failed'} */
  let easebuzzOutcome = 'success';

  function resetStore() {
    notifyCalls = [];
    receiptEmailCalls = [];
    activityCalls = [];
    easebuzzOutcome = 'success';
    tables = {
      maintenance_bills: [],
      maintenance_payments: [],
      users: [
        {
          id: 'u1',
          building_id: 'b1',
          role: 'user',
          status: 'approved',
          expo_push_token: 'ExponentPushToken[aaa]',
          app_language: 'en',
          name: 'User One',
          email: 'u1@example.com',
        },
        {
          id: 'u2',
          building_id: 'b1',
          role: 'pramukh',
          status: 'approved',
          expo_push_token: 'ExponentPushToken[bbb]',
          app_language: 'en',
          name: 'Pramukh',
          email: 'p@example.com',
        },
        {
          id: 'u3',
          building_id: 'b1',
          role: 'user',
          status: 'approved',
          expo_push_token: 'ExponentPushToken[ccc]',
          app_language: 'en',
          name: 'User Three',
          email: 'u3@example.com',
        },
      ],
    };
  }

  function applyFilters(rows, state) {
    let out = rows;
    out = out.filter((r) => state.filters.every(([c, v]) => String(r[c]) === String(v)));
    for (const [c, vals] of state.inFilters) {
      out = out.filter((r) => vals.map(String).includes(String(r[c])));
    }
    return out;
  }

  function createMockSupabase() {
    return {
      from(table) {
        const state = {
          filters: /** @type {Array<[string, any]>} */ ([]),
          inFilters: /** @type {Array<[string, any[]]>} */ ([]),
          mode: 'select',
          insertRows: null,
          updatePatch: null,
        };

        const finishSelect = () => {
          const rows = applyFilters(tables[table] || [], state);
          return { data: rows, error: null };
        };

        const api = {
          select() {
            return api;
          },
          eq(col, val) {
            state.filters.push([col, val]);
            return api;
          },
          in(col, vals) {
            state.inFilters.push([col, vals]);
            return api;
          },
          order() {
            return api;
          },
          insert(rows) {
            state.mode = 'insert';
            state.insertRows = Array.isArray(rows) ? rows : [rows];
            return api;
          },
          update(patch) {
            state.mode = 'update';
            state.updatePatch = patch;
            return api;
          },
          async single() {
            if (state.mode === 'insert') {
              if (!tables[table]) tables[table] = [];
              const row = {
                ...state.insertRows[0],
                id: `${table}-${tables[table].length + 1}`,
              };
              tables[table].push(row);
              return { data: row, error: null };
            }
            if (state.mode === 'update') {
              const rows = applyFilters(tables[table] || [], state);
              if (!rows.length) return { data: null, error: { message: 'not found' } };
              Object.assign(rows[0], state.updatePatch);
              return { data: rows[0], error: null };
            }
            const rows = applyFilters(tables[table] || [], state);
            return rows[0]
              ? { data: rows[0], error: null }
              : { data: null, error: { message: 'not found' } };
          },
          async maybeSingle() {
            const rows = applyFilters(tables[table] || [], state);
            return { data: rows[0] || null, error: null };
          },
          then(resolve, reject) {
            try {
              if (state.mode === 'insert') {
                if (!tables[table]) tables[table] = [];
                const inserted = state.insertRows.map((r, i) => ({
                  ...r,
                  id: r.id || `${table}-ins-${tables[table].length + i}`,
                }));
                tables[table].push(...inserted);
                return Promise.resolve({ data: inserted, error: null }).then(resolve, reject);
              }
              if (state.mode === 'update') {
                const rows = applyFilters(tables[table] || [], state);
                rows.forEach((r) => Object.assign(r, state.updatePatch));
                return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
              }
              return Promise.resolve(finishSelect()).then(resolve, reject);
            } catch (e) {
              return Promise.reject(e).then(resolve, reject);
            }
          },
        };
        return api;
      },
    };
  }

  function mockRes() {
    const res = {
      statusCode: 200,
      body: null,
      headers: {},
      redirected: null,
      status(code) {
        res.statusCode = code;
        return res;
      },
      json(payload) {
        res.body = payload;
        return res;
      },
      setHeader(k, v) {
        res.headers[k] = v;
        return res;
      },
      send(payload) {
        res.body = payload;
        return res;
      },
    };
    return res;
  }

  async function waitForAsyncSideEffects(ms = 80) {
    await new Promise((r) => setTimeout(r, ms));
  }

  function loadController({ notifyUserImpl } = {}) {
    clearModule(SUPABASE_PATH);
    clearModule(NS_PATH);
    clearModule(EXPENSE_PATH);
    clearModule(ACTIVITY_PATH);
    clearModule(RECEIPT_PATH);
    clearModule(IMAGE_PATH);
    clearModule(EASEBUZZ_PATH);
    clearModule(CONTROLLER_PATH);

    mockModule(SUPABASE_PATH, createMockSupabase());
    mockModule(IMAGE_PATH, {
      uploadImage: async () => ({ url: 'https://example.com/x.jpg', public_id: 'x' }),
    });
    mockModule(EASEBUZZ_PATH, {
      verifyResponseHash: () => true,
      mergeGatewayPayload: (req) => req.body || {},
      normalizePaymentStatus: () => easebuzzOutcome,
      isPaymentSuccess: (s) => s === 'success',
      redirectToApp: (res, url) => {
        res.redirected = url;
        res.statusCode = 302;
        return res;
      },
      initiatePayment: async () => ({ payment_url: 'https://pay.test' }),
      sanitizeTxnid: (s) => String(s).replace(/[^a-zA-Z0-9]/g, '').slice(0, 25),
    });
    mockModule(NS_PATH, {
      notifyMembers: async (...args) => {
        notifyCalls.push({ fn: 'notifyMembers', args });
      },
      notifyRecipients: async (...args) => {
        notifyCalls.push({ fn: 'notifyRecipients', args });
      },
      notifyGroups: async (...args) => {
        notifyCalls.push({ fn: 'notifyGroups', args });
      },
      notifyUser: notifyUserImpl || (async (...args) => {
        notifyCalls.push({ fn: 'notifyUser', args });
      }),
    });
    mockModule(EXPENSE_PATH, async () => {});
    mockModule(ACTIVITY_PATH, {
      logActivity: async (...args) => {
        activityCalls.push(args);
      },
    });
    mockModule(RECEIPT_PATH, {
      buildReceiptPdfBuffer: async () => Buffer.from('%PDF-1.4 mock'),
      sendPaymentReceiptEmail: async (id) => {
        receiptEmailCalls.push(id);
      },
      RECEIPT_SELECT: '*',
      methodLabelFromRecord: () => 'Cash',
      categoryLabelFromBill: () => 'Receipt',
    });

    return require('../src/controllers/maintenanceController');
  }

  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    clearModule(CONTROLLER_PATH);
    clearModule(IMAGE_PATH);
    clearModule(EASEBUZZ_PATH);
  });

  it('addBill maintenance notifies society members', async () => {
    const c = loadController();
    const res = mockRes();
    await c.addBill(
      {
        user: { id: 'admin1', building_id: 'b1', role: 'pramukh' },
        body: {
          category: 'maintenance',
          amount: 1200,
          month: 4,
          year: 2026,
          due_date: '2026-04-15',
          description: 'April maintenance',
          penalty_amount: 100,
        },
      },
      res,
    );

    assert.equal(res.statusCode, 201);
    assert.ok(tables.maintenance_bills.length >= 1);
    assert.ok(tables.maintenance_payments.length >= 2);
    const billNotify = notifyCalls.find((n) => n.fn === 'notifyMembers');
    assert.ok(billNotify, 'expected notifyMembers on maintenance bill create');
    assert.equal(billNotify.args[0], 'b1');
    assert.equal(billNotify.args[1].type, 'bill');
    assert.equal(billNotify.args[1].meta.category, 'maintenance');
    const copy = billNotify.args[1].build('en');
    assert.ok(copy.title);
    assert.ok(copy.body);
  });

  it('addBill water_meter uniform notifies members', async () => {
    const c = loadController();
    const res = mockRes();
    await c.addBill(
      {
        user: { id: 'admin1', building_id: 'b1', role: 'pramukh' },
        body: {
          category: 'water_meter',
          amount_mode: 'uniform',
          amount: 300,
          due_date: '2026-04-20',
        },
      },
      res,
    );

    assert.equal(res.statusCode, 201);
    const billNotify = notifyCalls.find((n) => n.fn === 'notifyMembers');
    assert.ok(billNotify);
    assert.equal(billNotify.args[1].meta.category, 'water_meter');
  });

  it('addBill water_meter flat_wise uses notifyGroups', async () => {
    const c = loadController();
    const res = mockRes();
    await c.addBill(
      {
        user: { id: 'admin1', building_id: 'b1', role: 'pramukh' },
        body: {
          category: 'water_meter',
          amount_mode: 'flat_wise',
          due_date: '2026-04-21',
          flat_amounts: [
            { user_id: 'u1', amount: 250 },
            { user_id: 'u3', amount: 400 },
          ],
        },
      },
      res,
    );

    assert.equal(res.statusCode, 201);
    assert.equal(tables.maintenance_payments.length, 2);
    const groups = notifyCalls.find((n) => n.fn === 'notifyGroups');
    assert.ok(groups, 'expected notifyGroups for water flat_wise');
    assert.ok(Array.isArray(groups.args[0]));
    assert.ok(groups.args[0].length >= 1);
  });

  it('addBill special building-wide notifies members', async () => {
    const c = loadController();
    const res = mockRes();
    await c.addBill(
      {
        user: { id: 'admin1', building_id: 'b1', role: 'pramukh' },
        body: {
          category: 'special',
          amount: 500,
          due_date: '2026-04-25',
          description: 'Lift repair',
          targeting_mode: 'building_wide',
        },
      },
      res,
    );

    assert.equal(res.statusCode, 201);
    const billNotify = notifyCalls.find((n) => n.fn === 'notifyMembers');
    assert.ok(billNotify);
    assert.equal(billNotify.args[1].type, 'bill');
    assert.equal(billNotify.args[1].meta.category, 'special');
  });

  it('addBill special targeted uses notifyRecipients', async () => {
    const c = loadController();
    const res = mockRes();
    await c.addBill(
      {
        user: { id: 'admin1', building_id: 'b1', role: 'pramukh' },
        body: {
          category: 'special',
          amount: 750,
          due_date: '2026-04-26',
          description: 'Wing A painting',
          targeting_mode: 'targeted',
          targeted_user_ids: ['u1'],
        },
      },
      res,
    );

    assert.equal(res.statusCode, 201);
    assert.equal(tables.maintenance_payments.length, 1);
    assert.equal(tables.maintenance_payments[0].user_id, 'u1');
    const targeted = notifyCalls.find((n) => n.fn === 'notifyRecipients');
    assert.ok(targeted, 'expected notifyRecipients for targeted special bill');
    assert.equal(targeted.args[1].meta.category, 'special');
  });

  it('addBill special flat_wise uses notifyGroups', async () => {
    const c = loadController();
    const res = mockRes();
    await c.addBill(
      {
        user: { id: 'admin1', building_id: 'b1', role: 'pramukh' },
        body: {
          category: 'special',
          amount_mode: 'flat_wise',
          due_date: '2026-04-27',
          description: 'Parking resurfacing',
          flat_amounts: [
            { user_id: 'u1', amount: 100 },
            { user_id: 'u3', amount: 200 },
          ],
        },
      },
      res,
    );

    assert.equal(res.statusCode, 201);
    const groups = notifyCalls.find((n) => n.fn === 'notifyGroups');
    assert.ok(groups);
  });

  it('addBill rejects penalty on non-maintenance and invalid category', async () => {
    const c = loadController();
    const resPenalty = mockRes();
    await c.addBill(
      {
        user: { id: 'admin1', building_id: 'b1', role: 'pramukh' },
        body: {
          category: 'water_meter',
          amount: 100,
          due_date: '2026-04-20',
          penalty_amount: 10,
        },
      },
      resPenalty,
    );
    assert.equal(resPenalty.statusCode, 422);

    const resCat = mockRes();
    await c.addBill(
      {
        user: { id: 'admin1', building_id: 'b1', role: 'pramukh' },
        body: { category: 'garbage', amount: 1, due_date: '2026-04-20' },
      },
      resCat,
    );
    assert.equal(resCat.statusCode, 422);
    assert.equal(notifyCalls.length, 0);
  });

  it('approvePayment notifies user and emails receipt (cash)', async () => {
    tables.maintenance_payments = [
      {
        id: 'pay-1',
        user_id: 'u1',
        building_id: 'b1',
        status: 'receipt_uploaded',
        amount: 1200,
        total_amount: 1200,
        payment_method: 'cash',
        maintenance_bills: { month: 4, year: 2026, amount: 1200, category: 'maintenance' },
        users: { name: 'User One', role: 'user', email: 'u1@example.com' },
      },
    ];

    const c = loadController();
    const res = mockRes();
    await c.approvePayment(
      {
        user: { id: 'p1', building_id: 'b1', role: 'pramukh' },
        params: { id: 'pay-1' },
      },
      res,
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, 'paid');
    assert.equal(tables.maintenance_payments[0].status, 'paid');

    await waitForAsyncSideEffects();

    const userNotify = notifyCalls.find((n) => n.fn === 'notifyUser');
    assert.ok(userNotify, 'expected notifyUser after approve');
    assert.equal(userNotify.args[0], 'u1');
    assert.equal(userNotify.args[1].type, 'payment_approved');
    assert.ok(receiptEmailCalls.includes('pay-1'), 'expected sendPaymentReceiptEmail(pay-1)');
  });

  it('approvePayment cheque still emails receipt and preserves method', async () => {
    tables.maintenance_payments = [
      {
        id: 'pay-cheque',
        user_id: 'u1',
        building_id: 'b1',
        status: 'receipt_uploaded',
        amount: 900,
        total_amount: 900,
        payment_method: 'cheque',
        maintenance_bills: { month: 3, year: 2026, amount: 900, category: 'maintenance' },
        users: { name: 'User One', role: 'user', email: 'u1@example.com' },
      },
    ];
    const c = loadController();
    const res = mockRes();
    await c.approvePayment(
      { user: { id: 'p1', building_id: 'b1', role: 'pramukh' }, params: { id: 'pay-cheque' } },
      res,
    );
    assert.equal(res.statusCode, 200);
    assert.equal(tables.maintenance_payments[0].payment_method, 'cheque');
    await waitForAsyncSideEffects();
    assert.ok(receiptEmailCalls.includes('pay-cheque'));
  });

  it('approvePayment still emails when notifyUser throws', async () => {
    tables.maintenance_payments = [
      {
        id: 'pay-notify-fail',
        user_id: 'u1',
        building_id: 'b1',
        status: 'cash_requested',
        amount: 100,
        total_amount: 100,
        payment_method: 'cash',
        maintenance_bills: { month: 2, year: 2026, amount: 100 },
        users: { name: 'User One', role: 'user', email: 'u1@example.com' },
      },
    ];
    const c = loadController({
      notifyUserImpl: async () => {
        throw new Error('push down');
      },
    });
    const res = mockRes();
    await c.approvePayment(
      { user: { id: 'p1', building_id: 'b1', role: 'pramukh' }, params: { id: 'pay-notify-fail' } },
      res,
    );
    assert.equal(res.statusCode, 200);
    await waitForAsyncSideEffects();
    assert.ok(receiptEmailCalls.includes('pay-notify-fail'));
  });

  it('approvePayment rejects already-paid records without emailing again', async () => {
    tables.maintenance_payments = [
      {
        id: 'pay-2',
        user_id: 'u1',
        building_id: 'b1',
        status: 'paid',
        amount: 100,
        total_amount: 100,
        payment_method: 'cash',
        maintenance_bills: { month: 1, year: 2026, amount: 100 },
        users: { name: 'User One', role: 'user', email: 'u1@example.com' },
      },
    ];
    const c = loadController();
    const res = mockRes();
    await c.approvePayment(
      { user: { id: 'p1', building_id: 'b1', role: 'pramukh' }, params: { id: 'pay-2' } },
      res,
    );
    assert.equal(res.statusCode, 400);
    await waitForAsyncSideEffects(40);
    assert.equal(receiptEmailCalls.length, 0);
  });

  it('easebuzzCallback success notifies user and emails receipt', async () => {
    tables.maintenance_payments = [
      {
        id: 'pay-eb',
        user_id: 'u1',
        building_id: 'b1',
        status: 'pending',
        amount: 1500,
        total_amount: 1500,
        maintenance_bills: { month: 4, year: 2026, amount: 1500, category: 'maintenance' },
        users: { name: 'User One', role: 'user', email: 'u1@example.com' },
      },
    ];
    easebuzzOutcome = 'success';
    const c = loadController();
    const res = mockRes();
    await c.easebuzzCallback(
      {
        query: { record_id: 'pay-eb', txn_id: 'TXN1' },
        body: { easepayid: 'EBZ999', status: 'success' },
      },
      res,
    );

    assert.equal(res.statusCode, 302);
    assert.match(String(res.redirected), /status=success/);
    assert.equal(tables.maintenance_payments[0].status, 'paid');
    assert.equal(tables.maintenance_payments[0].payment_method, 'online_easebuzz');

    await waitForAsyncSideEffects(100);

    const userNotify = notifyCalls.find((n) => n.fn === 'notifyUser');
    assert.ok(userNotify, 'expected notifyUser after easebuzz success');
    assert.equal(userNotify.args[0], 'u1');
    assert.ok(receiptEmailCalls.includes('pay-eb'));
    assert.ok(activityCalls.length >= 1);
  });

  it('easebuzzCallback failure does not email receipt', async () => {
    tables.maintenance_payments = [
      {
        id: 'pay-eb-fail',
        user_id: 'u1',
        building_id: 'b1',
        status: 'pending',
        amount: 500,
        total_amount: 500,
        maintenance_bills: { month: 4, year: 2026, amount: 500, category: 'water_meter' },
        users: { name: 'User One', role: 'user', email: 'u1@example.com' },
      },
    ];
    easebuzzOutcome = 'failed';
    const c = loadController();
    const res = mockRes();
    await c.easebuzzCallback(
      {
        query: { record_id: 'pay-eb-fail', txn_id: 'TXN2' },
        body: { status: 'failure' },
      },
      res,
    );

    assert.equal(res.statusCode, 302);
    assert.match(String(res.redirected), /status=failed/);
    assert.equal(tables.maintenance_payments[0].status, 'pending');
    await waitForAsyncSideEffects(60);
    assert.equal(receiptEmailCalls.length, 0);
    assert.equal(notifyCalls.filter((n) => n.fn === 'notifyUser').length, 0);
  });

  it('downloadReceipt streams PDF for paid record', async () => {
    tables.maintenance_payments = [
      {
        id: 'pay-dl-12345678',
        user_id: 'u1',
        building_id: 'b1',
        status: 'paid',
        amount: 1200,
        total_amount: 1200,
        payment_method: 'online_easebuzz',
        maintenance_bills: { month: 4, year: 2026, amount: 1200, category: 'maintenance' },
        users: { name: 'User One', email: 'u1@example.com' },
        buildings: { name: 'Green Heights' },
      },
    ];
    const c = loadController();
    const res = mockRes();
    await c.downloadReceipt(
      { user: { id: 'u1', role: 'user' }, params: { payment_record_id: 'pay-dl-12345678' } },
      res,
    );
    assert.equal(res.headers['Content-Type'], 'application/pdf');
    assert.ok(Buffer.isBuffer(res.body) || typeof res.body === 'string');
  });

  it('downloadReceipt rejects unpaid and other-user access', async () => {
    tables.maintenance_payments = [
      {
        id: 'pay-dl-unpaid',
        user_id: 'u1',
        building_id: 'b1',
        status: 'pending',
        amount: 100,
        total_amount: 100,
      },
      {
        id: 'pay-dl-other',
        user_id: 'u3',
        building_id: 'b1',
        status: 'paid',
        amount: 100,
        total_amount: 100,
      },
    ];
    const c = loadController();

    const unpaid = mockRes();
    await c.downloadReceipt(
      { user: { id: 'u1', role: 'user' }, params: { payment_record_id: 'pay-dl-unpaid' } },
      unpaid,
    );
    assert.equal(unpaid.statusCode, 400);

    const denied = mockRes();
    await c.downloadReceipt(
      { user: { id: 'u1', role: 'user' }, params: { payment_record_id: 'pay-dl-other' } },
      denied,
    );
    assert.equal(denied.statusCode, 403);
  });
});
