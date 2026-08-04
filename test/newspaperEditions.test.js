/**
 * Newspaper edition tests (node:test).
 * Covers: multi-PDF upload with titles on same date+language,
 * and hard isolation so editions never leak across date/language.
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const SUPABASE_PATH = require.resolve('../src/supabase');
const NS_PATH = require.resolve('../src/utils/notificationService');
const CONTROLLER_PATH = require.resolve('../src/controllers/newspaperController');

/** @type {Array<Record<string, any>>} */
let store = [];
let notifyCalls = [];

function matchesFilters(row, filters) {
  return filters.every(([col, val]) => String(row[col]) === String(val));
}

function createMockSupabase() {
  return {
    from(table) {
      if (table !== 'newspaper_editions' && table !== 'subscriptions') {
        return createTableApi(table);
      }
      return createTableApi(table);
    },
    storage: {
      from() {
        return {
          async upload() {
            return { data: { path: 'ok' }, error: null };
          },
          getPublicUrl(fileName) {
            return { data: { publicUrl: `https://cdn.test/${fileName}` } };
          },
          async createSignedUrl() {
            return { data: { signedUrl: 'https://cdn.test/signed.pdf' }, error: null };
          },
          async remove() {
            return { data: null, error: null };
          },
        };
      },
    },
  };
}

function createTableApi(table) {
  const state = {
    filters: /** @type {Array<[string, any]>} */ ([]),
    insertRow: null,
    mode: 'select',
    orderAsc: true,
  };

  const api = {
    select() {
      return api;
    },
    eq(col, val) {
      state.filters.push([col, val]);
      return api;
    },
    or() {
      return api;
    },
    order(_col, opts = {}) {
      state.orderAsc = opts.ascending !== false;
      return api;
    },
    limit() {
      return api;
    },
    insert(row) {
      state.mode = 'insert';
      state.insertRow = { ...row, id: `id-${store.length + 1}`, created_at: new Date().toISOString() };
      return api;
    },
    update() {
      state.mode = 'update';
      return api;
    },
    delete() {
      state.mode = 'delete';
      return api;
    },
    async single() {
      if (table === 'subscriptions') {
        return {
          data: {
            newspaper_addon: true,
            newspaper_expires_at: null,
            status: 'active',
            expires_at: null,
          },
          error: null,
        };
      }
      if (state.mode === 'insert' && state.insertRow) {
        store.push(state.insertRow);
        return { data: state.insertRow, error: null };
      }
      const found = store.find((r) => matchesFilters(r, state.filters));
      return found ? { data: found, error: null } : { data: null, error: { message: 'not found' } };
    },
    async maybeSingle() {
      const found = store.find((r) => matchesFilters(r, state.filters));
      return { data: found || null, error: null };
    },
    then(resolve, reject) {
      // Awaited select chains end here
      try {
        if (table === 'subscriptions') {
          return Promise.resolve({
            data: [{
              user_id: 'user-1',
              expires_at: null,
              newspaper_expires_at: null,
            }],
            error: null,
          }).then(resolve, reject);
        }
        if (state.mode === 'delete') {
          const before = store.length;
          store = store.filter((r) => !matchesFilters(r, state.filters));
          return Promise.resolve({
            data: null,
            error: store.length === before && state.filters.length ? { message: 'delete failed' } : null,
          }).then(resolve, reject);
        }
        let rows = store.filter((r) => matchesFilters(r, state.filters));
        rows = rows.slice().sort((a, b) => {
          const av = a.created_at || '';
          const bv = b.created_at || '';
          return state.orderAsc ? av.localeCompare(bv) : bv.localeCompare(av);
        });
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      } catch (e) {
        return Promise.reject(e).then(resolve, reject);
      }
    },
  };

  return api;
}

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

function loadController() {
  require.cache[SUPABASE_PATH] = {
    id: SUPABASE_PATH,
    filename: SUPABASE_PATH,
    loaded: true,
    exports: createMockSupabase(),
  };
  require.cache[NS_PATH] = {
    id: NS_PATH,
    filename: NS_PATH,
    loaded: true,
    exports: {
      notifyUser: async (...args) => {
        notifyCalls.push(['notifyUser', ...args]);
      },
      notifyUsersByIds: async (...args) => {
        notifyCalls.push(['notifyUsersByIds', ...args]);
      },
      notifyRecipients: async (...args) => {
        notifyCalls.push(['notifyRecipients', ...args]);
      },
    },
  };
  delete require.cache[CONTROLLER_PATH];
  // notificationCopy is real — fine
  return require('../src/controllers/newspaperController');
}

describe('newspaper editions — multi PDF same date/language + scope isolation', () => {
  /** @type {any} */
  let newspaper;

  beforeEach(() => {
    store = [];
    notifyCalls = [];
    newspaper = loadController();
  });

  it('rejects upload without title', async () => {
    const res = mockRes();
    await newspaper.uploadEdition(
      { user: { id: 'admin-1', role: 'admin' }, body: { date: '2026-07-19', language: 'english', url: 'https://x/a.pdf' }, file: null },
      res,
    );
    assert.equal(res.statusCode, 422);
    assert.match(res.body.error, /title/i);
    assert.equal(store.length, 0);
  });

  it('rejects upload with invalid language', async () => {
    const res = mockRes();
    await newspaper.uploadEdition(
      {
        user: { id: 'admin-1', role: 'admin' },
        body: { date: '2026-07-19', language: 'french', title: 'Le Monde', url: 'https://x/a.pdf' },
        file: null,
      },
      res,
    );
    assert.equal(res.statusCode, 422);
    assert.match(res.body.error, /invalid language/i);
    assert.equal(store.length, 0);
  });

  it('rejects upload without file or url', async () => {
    const res = mockRes();
    await newspaper.uploadEdition(
      {
        user: { id: 'admin-1', role: 'admin' },
        body: { date: '2026-07-19', language: 'english', title: 'TOI' },
        file: null,
      },
      res,
    );
    assert.equal(res.statusCode, 422);
    assert.match(res.body.error, /file|storage_path|url/i);
  });

  it('admin can upload multiple titled PDFs for the SAME date and SAME language (insert, not replace)', async () => {
    const admin = { id: 'admin-1', role: 'admin' };
    const date = '2026-07-19';
    const language = 'english';

    for (const title of ['Times of India', 'The Hindu', 'Indian Express']) {
      const res = mockRes();
      await newspaper.uploadEdition(
        {
          user: admin,
          body: { date, language, title, url: `https://cdn.test/${title}.pdf` },
          file: null,
        },
        res,
      );
      assert.equal(res.statusCode, 201, res.body?.error);
      assert.equal(res.body.edition.title, title);
      assert.equal(res.body.edition.date, date);
      assert.equal(res.body.edition.language, language);
    }

    assert.equal(store.length, 3, 'all three editions must remain (no upsert)');
    assert.deepEqual(
      store.map((r) => r.title).sort(),
      ['Indian Express', 'The Hindu', 'Times of India'],
    );
  });

  it('list returns ONLY editions for the requested date+language (not other language)', async () => {
    const admin = { id: 'admin-1', role: 'admin' };

    await newspaper.uploadEdition(
      { user: admin, body: { date: '2026-07-19', language: 'english', title: 'TOI EN', url: 'https://x/en.pdf' }, file: null },
      mockRes(),
    );
    await newspaper.uploadEdition(
      { user: admin, body: { date: '2026-07-19', language: 'hindi', title: 'TOI HI', url: 'https://x/hi.pdf' }, file: null },
      mockRes(),
    );
    await newspaper.uploadEdition(
      { user: admin, body: { date: '2026-07-19', language: 'english', title: 'Hindu EN', url: 'https://x/en2.pdf' }, file: null },
      mockRes(),
    );

    const res = mockRes();
    await newspaper.listEditions(
      { user: { id: 'u1', role: 'user' }, query: { date: '2026-07-19', language: 'english' } },
      res,
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.date, '2026-07-19');
    assert.equal(res.body.language, 'english');
    assert.equal(res.body.editions.length, 2);
    assert.deepEqual(
      res.body.editions.map((e) => e.title).sort(),
      ['Hindu EN', 'TOI EN'],
    );
    assert.ok(res.body.editions.every((e) => e.language === 'english'));
    assert.ok(!res.body.editions.some((e) => e.title === 'TOI HI'), 'hindi edition must not appear in english list');
  });

  it('list returns ONLY editions for the requested date (not other date, same language)', async () => {
    const admin = { id: 'admin-1', role: 'admin' };

    await newspaper.uploadEdition(
      { user: admin, body: { date: '2026-07-19', language: 'gujarati', title: 'Sandesh 19', url: 'https://x/19.pdf' }, file: null },
      mockRes(),
    );
    await newspaper.uploadEdition(
      { user: admin, body: { date: '2026-07-20', language: 'gujarati', title: 'Sandesh 20', url: 'https://x/20.pdf' }, file: null },
      mockRes(),
    );
    await newspaper.uploadEdition(
      { user: admin, body: { date: '2026-07-19', language: 'gujarati', title: 'Gujarat Samachar 19', url: 'https://x/19b.pdf' }, file: null },
      mockRes(),
    );

    const res = mockRes();
    await newspaper.listEditions(
      { user: { id: 'u1', role: 'admin' }, query: { date: '2026-07-19', language: 'gujarati' } },
      res,
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.editions.length, 2);
    assert.deepEqual(
      res.body.editions.map((e) => e.title).sort(),
      ['Gujarat Samachar 19', 'Sandesh 19'],
    );
    assert.ok(!res.body.editions.some((e) => e.title === 'Sandesh 20'));
    assert.ok(res.body.editions.every((e) => String(e.date).slice(0, 10) === '2026-07-19'));
  });

  it('list returns 404 when no editions exist for that date+language pair', async () => {
    const admin = { id: 'admin-1', role: 'admin' };
    await newspaper.uploadEdition(
      { user: admin, body: { date: '2026-07-19', language: 'english', title: 'Only EN', url: 'https://x/a.pdf' }, file: null },
      mockRes(),
    );

    const res = mockRes();
    await newspaper.listEditions(
      { user: { id: 'u1', role: 'user' }, query: { date: '2026-07-19', language: 'hindi' } },
      res,
    );
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, 'not_available');
  });

  it('open by id returns that edition only (correct title/url)', async () => {
    const admin = { id: 'admin-1', role: 'admin' };
    const uploadRes = mockRes();
    await newspaper.uploadEdition(
      { user: admin, body: { date: '2026-07-19', language: 'english', title: 'Mint', url: 'https://x/mint.pdf' }, file: null },
      uploadRes,
    );
    const id = uploadRes.body.edition.id;

    const res = mockRes();
    await newspaper.getEditionById(
      { user: { id: 'u1', role: 'user' }, params: { id } },
      res,
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.title, 'Mint');
    assert.equal(res.body.language, 'english');
    assert.ok(res.body.url);
  });

  it('file upload path is scoped under language/date and still allows multiple inserts', async () => {
    const admin = { id: 'admin-1', role: 'admin' };
    const date = '2026-07-19';
    const language = 'hindi';

    const r1 = mockRes();
    await newspaper.uploadEdition(
      {
        user: admin,
        body: { date, language, title: 'Dainik Bhaskar' },
        file: { buffer: Buffer.from('%PDF-1'), mimetype: 'application/pdf' },
      },
      r1,
    );
    const r2 = mockRes();
    await newspaper.uploadEdition(
      {
        user: admin,
        body: { date, language, title: 'Amar Ujala' },
        file: { buffer: Buffer.from('%PDF-2'), mimetype: 'application/pdf' },
      },
      r2,
    );

    assert.equal(r1.statusCode, 201, r1.body?.error);
    assert.equal(r2.statusCode, 201, r2.body?.error);
    assert.equal(store.length, 2);
    assert.ok(r1.body.file_url.includes(`/hindi/`), r1.body.file_url);
    assert.ok(r1.body.file_url.includes('2026-07-19'), r1.body.file_url);
    assert.ok(r2.body.file_url.includes(`/hindi/`));
    assert.notEqual(r1.body.file_url, r2.body.file_url);

    const listRes = mockRes();
    await newspaper.listEditions(
      { user: { id: 'admin-1', role: 'admin' }, query: { date, language } },
      listRes,
    );
    assert.equal(listRes.body.editions.length, 2);
  });

  it('requires date and language on list', async () => {
    const res = mockRes();
    await newspaper.listEditions({ user: { id: 'a', role: 'admin' }, query: { date: '2026-07-19' } }, res);
    assert.equal(res.statusCode, 422);
  });

  it('admin can delete one edition without removing other PDFs on same date+language', async () => {
    const admin = { id: 'admin-1', role: 'admin' };
    const date = '2026-07-19';
    const language = 'english';

    const a = mockRes();
    await newspaper.uploadEdition(
      { user: admin, body: { date, language, title: 'Keep Me', url: 'https://x/keep.pdf' }, file: null },
      a,
    );
    const b = mockRes();
    await newspaper.uploadEdition(
      { user: admin, body: { date, language, title: 'Delete Me', url: 'https://x/del.pdf' }, file: null },
      b,
    );
    assert.equal(store.length, 2);

    const delRes = mockRes();
    await newspaper.deleteEdition(
      { user: admin, params: { id: b.body.edition.id } },
      delRes,
    );
    assert.equal(delRes.statusCode, 200);
    assert.equal(store.length, 1);
    assert.equal(store[0].title, 'Keep Me');

    const listRes = mockRes();
    await newspaper.listEditions(
      { user: admin, query: { date, language } },
      listRes,
    );
    assert.equal(listRes.body.editions.length, 1);
    assert.equal(listRes.body.editions[0].title, 'Keep Me');
  });

  it('delete returns 404 for unknown edition id', async () => {
    const res = mockRes();
    await newspaper.deleteEdition(
      { user: { id: 'admin-1', role: 'admin' }, params: { id: 'missing-id' } },
      res,
    );
    assert.equal(res.statusCode, 404);
  });
});
