const crypto = require('crypto');
const axios = require('axios');

// PhonePe UAT (Test) Credentials by default
const PHONEPE_MERCHANT_ID = process.env.PHONEPE_MERCHANT_ID || 'PGTESTPAYUAT86';
const PHONEPE_SALT_KEY = process.env.PHONEPE_SALT_KEY || '96434309-7796-489d-8924-ab56988a6076';
const PHONEPE_SALT_INDEX = process.env.PHONEPE_SALT_INDEX || '1';
const PHONEPE_ENV = process.env.PHONEPE_ENV || 'UAT'; // 'UAT' or 'PROD'

const PHONEPE_HOST = PHONEPE_ENV === 'PROD' 
  ? 'https://api.phonepe.com/apis/hermes' 
  : 'https://api-preprod.phonepe.com/apis/pg-sandbox';

/**
 * Creates a PhonePe payment payload and checksum
 * @param {Object} paymentData 
 * @param {string} paymentData.merchantTransactionId - Unique ID for this transaction
 * @param {number} paymentData.amount - Amount in rupees (will be converted to paise internally)
 * @param {string} paymentData.userId - User ID making the payment
 * @param {string} paymentData.mobileNumber - User's mobile number
 * @param {string} paymentData.redirectUrl - Where the app/web should return after payment
 * @returns {Object} payload & checksum to send to PhonePe API
 */
const generatePaymentRequest = async ({ merchantTransactionId, amount, userId, mobileNumber, redirectUrl }) => {
  const payload = {
    merchantId: PHONEPE_MERCHANT_ID,
    merchantTransactionId,
    merchantUserId: userId.replace(/-/g, '').substring(0, 34),
    amount: Math.round(amount * 100), // Convert to paise
    redirectUrl,
    redirectMode: "REDIRECT",
    callbackUrl: redirectUrl, // S2S callback (webhook) if needed
    mobileNumber: (mobileNumber || "9999999999").replace(/\D/g, '').slice(-10),
    paymentInstrument: {
      type: "PAY_PAGE"
    }
  };

  const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
  const endpoint = '/pg/v1/pay';
  const checksum = crypto.createHash('sha256').update(base64Payload + endpoint + PHONEPE_SALT_KEY).digest('hex') + '###' + PHONEPE_SALT_INDEX;

  try {
    const response = await axios.post(
      `${PHONEPE_HOST}${endpoint}`,
      { request: base64Payload },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-VERIFY': checksum,
          'X-MERCHANT-ID': PHONEPE_MERCHANT_ID
        }
      }
    );

    return response.data; // Contains the URL to open in WebView or SDK
  } catch (error) {
    console.error("PhonePe Payment Create Error:", error.response?.data || error.message);
    throw new Error("Failed to initiate PhonePe payment");
  }
};

/**
 * Checks the status of a PhonePe transaction
 * @param {string} merchantTransactionId 
 */
const checkPaymentStatus = async (merchantTransactionId) => {
  const endpoint = `/pg/v1/status/${PHONEPE_MERCHANT_ID}/${merchantTransactionId}`;
  const checksum = crypto.createHash('sha256').update(endpoint + PHONEPE_SALT_KEY).digest('hex') + '###' + PHONEPE_SALT_INDEX;

  try {
    const response = await axios.get(
      `${PHONEPE_HOST}${endpoint}`,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-VERIFY': checksum,
          'X-MERCHANT-ID': PHONEPE_MERCHANT_ID
        }
      }
    );

    return response.data;
  } catch (error) {
    console.error("PhonePe Status Check Error:", error.response?.data || error.message);
    throw new Error("Failed to check PhonePe payment status");
  }
};

module.exports = {
  generatePaymentRequest,
  checkPaymentStatus
};
