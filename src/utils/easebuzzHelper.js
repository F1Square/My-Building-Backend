const crypto = require('crypto');
const axios = require('axios');

const EASEBUZZ_KEY = process.env.EASEBUZZ_KEY || '';
const EASEBUZZ_SALT = process.env.EASEBUZZ_SALT || '';
const EASEBUZZ_BASE_URL = (process.env.EASEBUZZ_BASE_URL || 'https://testpay.easebuzz.in').replace(/\/+$/, '');

function assertConfig() {
  if (!EASEBUZZ_KEY || !EASEBUZZ_SALT) {
    throw new Error('Easebuzz credentials are missing. Set EASEBUZZ_KEY and EASEBUZZ_SALT.');
  }
}

function toAmountString(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) throw new Error('Invalid amount');
  return n.toFixed(2);
}

/**
 * Easebuzz merchant configs often reject punctuation in productinfo/udf
 * (e.g. '/', ':'). Allow only A–Z, a–z, 0–9, space, underscore, hyphen.
 */
function sanitizeEasebuzzText(value, maxLen, fallbackWhenEmpty = '') {
  const s = String(value ?? '');
  const cleaned = s
    .replace(/[^a-zA-Z0-9 _-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
  return cleaned || fallbackWhenEmpty;
}

/** Docs / integrations: txnid alphanumeric only, max 25 chars. */
function sanitizeTxnid(txnid) {
  const alnum = String(txnid ?? '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 25);
  if (alnum.length >= 6) return alnum;
  const ts = String(Date.now());
  return `T${ts}`.slice(0, 25);
}

function buildInitiateHash({ txnid, amount, productinfo, firstname, email, udf1 = '', udf2 = '', udf3 = '', udf4 = '', udf5 = '' }) {
  const raw = [
    EASEBUZZ_KEY,
    txnid,
    amount,
    productinfo,
    firstname,
    email,
    udf1,
    udf2,
    udf3,
    udf4,
    udf5,
    '',
    '',
    '',
    '',
    '',
    EASEBUZZ_SALT,
  ].join('|');
  return crypto.createHash('sha512').update(raw).digest('hex');
}

function verifyResponseHash(payload = {}) {
  try {
    assertConfig();
    const {
      status = '',
      udf5 = '',
      udf4 = '',
      udf3 = '',
      udf2 = '',
      udf1 = '',
      email = '',
      firstname = '',
      productinfo = '',
      amount = '',
      txnid = '',
      hash = '',
    } = payload;
    if (!hash || !txnid) return false;

    const reverse = [
      EASEBUZZ_SALT,
      status,
      '',
      '',
      '',
      '',
      '',
      udf5,
      udf4,
      udf3,
      udf2,
      udf1,
      email,
      firstname,
      productinfo,
      amount,
      txnid,
      EASEBUZZ_KEY,
    ].join('|');
    const computed = crypto.createHash('sha512').update(reverse).digest('hex');
    return computed === String(hash).toLowerCase();
  } catch {
    return false;
  }
}

async function initiatePayment({
  txnid,
  amount,
  productinfo,
  firstname,
  email,
  phone,
  surl,
  furl,
  udf1 = '',
  udf2 = '',
  udf3 = '',
  udf4 = '',
  udf5 = '',
}) {
  assertConfig();
  const amountString = toAmountString(amount);
  const txnidSafe = sanitizeTxnid(txnid);
  const productinfoSafe = sanitizeEasebuzzText(productinfo, 100, 'Payment');
  const firstnamePlain = String(firstname || 'Customer').trim().slice(0, 60) || 'Customer';
  const udf1Safe = sanitizeEasebuzzText(udf1, 100, '');
  const udf2Safe = sanitizeEasebuzzText(udf2, 100, '');
  const udf3Safe = sanitizeEasebuzzText(udf3, 100, '');
  const udf4Safe = sanitizeEasebuzzText(udf4, 100, '');
  const udf5Safe = sanitizeEasebuzzText(udf5, 100, '');
  const payload = new URLSearchParams({
    key: EASEBUZZ_KEY,
    txnid: txnidSafe,
    amount: amountString,
    productinfo: productinfoSafe,
    firstname: firstnamePlain,
    email: String(email || 'customer@example.com'),
    phone: String(phone || '9999999999').replace(/\D/g, '').slice(-10) || '9999999999',
    surl: String(surl),
    furl: String(furl || surl),
    udf1: udf1Safe,
    udf2: udf2Safe,
    udf3: udf3Safe,
    udf4: udf4Safe,
    udf5: udf5Safe,
    hash: buildInitiateHash({
      txnid: txnidSafe,
      amount: amountString,
      productinfo: productinfoSafe,
      firstname: firstnamePlain,
      email: String(email || 'customer@example.com'),
      udf1: udf1Safe,
      udf2: udf2Safe,
      udf3: udf3Safe,
      udf4: udf4Safe,
      udf5: udf5Safe,
    }),
  });

  const { data } = await axios.post(
    `${EASEBUZZ_BASE_URL}/payment/initiateLink`,
    payload.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );

  const isHttpUrl = (v) => typeof v === 'string' && /^https?:\/\//i.test(v.trim());

  // Easebuzz /payment/initiateLink has two success response shapes:
  //   Shape A: { status: 1, data: "<access_key_hash>" }
  //            → payment URL is EASEBUZZ_BASE_URL/pay/<hash>
  //   Shape B: { status: 1, data: { payment_url: "https://..." } }
  //            → payment URL is data.data.payment_url
  // When validation fails Easebuzz returns: { status: 0, data: "Parameter validation failed" }
  // or similar error strings — those must NEVER be used as URLs.

  let paymentUrl = null;

  if (data?.status === 1 || data?.status === '1') {
    if (isHttpUrl(data?.data?.payment_url)) {
      // Shape B
      paymentUrl = data.data.payment_url;
    } else if (isHttpUrl(data?.data)) {
      // Direct URL in data
      paymentUrl = data.data;
    } else if (typeof data?.data === 'string' && data.data.length > 10 && !data.data.includes(' ')) {
      // Shape A — access key hash; construct the checkout URL
      paymentUrl = `${EASEBUZZ_BASE_URL}/pay/${data.data}`;
    } else if (isHttpUrl(data?.payment_url)) {
      paymentUrl = data.payment_url;
    } else if (isHttpUrl(data?.url)) {
      paymentUrl = data.url;
    }
  }

  if (!paymentUrl) {
    const reason =
      data?.error_desc ||
      data?.message ||
      (typeof data?.data === 'string' ? data.data : null) ||
      'Failed to create Easebuzz payment link';
    console.error('[Easebuzz] initiatePayment failed. Raw response:', JSON.stringify(data));
    throw new Error(reason);
  }
  return { paymentUrl, raw: data };
}

module.exports = {
  initiatePayment,
  verifyResponseHash,
};
