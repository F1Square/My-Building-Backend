/** Major cities by Indian state/UT — keep in sync with visitor-web/src/data/indiaLocations.ts */
const { isValidPhone } = require('./validators');

const INDIA_STATES_CITIES = {
  'Andaman and Nicobar Islands': ['Port Blair', 'Havelock Island', 'Diglipur'],
  'Andhra Pradesh': ['Visakhapatnam', 'Vijayawada', 'Guntur', 'Nellore', 'Kurnool', 'Tirupati', 'Rajahmundry', 'Kakinada'],
  'Arunachal Pradesh': ['Itanagar', 'Tawang', 'Pasighat', 'Naharlagun'],
  Assam: ['Guwahati', 'Silchar', 'Dibrugarh', 'Jorhat', 'Tezpur', 'Nagaon'],
  Bihar: ['Patna', 'Gaya', 'Bhagalpur', 'Muzaffarpur', 'Purnia', 'Darbhanga'],
  Chandigarh: ['Chandigarh'],
  Chhattisgarh: ['Raipur', 'Bhilai', 'Bilaspur', 'Korba', 'Durg', 'Rajnandgaon'],
  'Dadra and Nagar Haveli and Daman and Diu': ['Daman', 'Diu', 'Silvassa'],
  Delhi: ['New Delhi', 'North Delhi', 'South Delhi', 'East Delhi', 'West Delhi', 'Central Delhi'],
  Goa: ['Panaji', 'Margao', 'Vasco da Gama', 'Mapusa', 'Ponda'],
  Gujarat: ['Ahmedabad', 'Surat', 'Vadodara', 'Rajkot', 'Bhavnagar', 'Gandhinagar', 'Jamnagar', 'Junagadh', 'Anand', 'Mehsana'],
  Haryana: ['Gurugram', 'Faridabad', 'Panipat', 'Ambala', 'Hisar', 'Karnal', 'Rohtak', 'Sonipat'],
  'Himachal Pradesh': ['Shimla', 'Dharamshala', 'Solan', 'Mandi', 'Kullu', 'Manali'],
  'Jammu and Kashmir': ['Srinagar', 'Jammu', 'Anantnag', 'Baramulla', 'Udhampur'],
  Jharkhand: ['Ranchi', 'Jamshedpur', 'Dhanbad', 'Bokaro', 'Hazaribagh', 'Deoghar'],
  Karnataka: ['Bengaluru', 'Mysuru', 'Hubli', 'Mangaluru', 'Belagavi', 'Mangalore', 'Davangere', 'Ballari'],
  Kerala: ['Thiruvananthapuram', 'Kochi', 'Kozhikode', 'Thrissur', 'Kollam', 'Alappuzha', 'Kannur'],
  Ladakh: ['Leh', 'Kargil'],
  Lakshadweep: ['Kavaratti', 'Agatti', 'Minicoy'],
  'Madhya Pradesh': ['Bhopal', 'Indore', 'Jabalpur', 'Gwalior', 'Ujjain', 'Sagar', 'Rewa'],
  Maharashtra: ['Mumbai', 'Pune', 'Nagpur', 'Nashik', 'Aurangabad', 'Thane', 'Navi Mumbai', 'Kolhapur', 'Solapur', 'Amravati'],
  Manipur: ['Imphal', 'Thoubal', 'Churachandpur'],
  Meghalaya: ['Shillong', 'Tura', 'Jowai'],
  Mizoram: ['Aizawl', 'Lunglei', 'Champhai'],
  Nagaland: ['Kohima', 'Dimapur', 'Mokokchung'],
  Odisha: ['Bhubaneswar', 'Cuttack', 'Rourkela', 'Berhampur', 'Sambalpur', 'Puri'],
  Puducherry: ['Puducherry', 'Karaikal', 'Mahe', 'Yanam'],
  Punjab: ['Ludhiana', 'Amritsar', 'Jalandhar', 'Patiala', 'Mohali', 'Bathinda'],
  Rajasthan: ['Jaipur', 'Jodhpur', 'Udaipur', 'Kota', 'Ajmer', 'Bikaner', 'Alwar'],
  Sikkim: ['Gangtok', 'Namchi', 'Gyalshing'],
  'Tamil Nadu': ['Chennai', 'Coimbatore', 'Madurai', 'Tiruchirappalli', 'Salem', 'Tirunelveli', 'Erode', 'Vellore'],
  Telangana: ['Hyderabad', 'Warangal', 'Nizamabad', 'Karimnagar', 'Khammam'],
  Tripura: ['Agartala', 'Udaipur', 'Dharmanagar'],
  'Uttar Pradesh': ['Lucknow', 'Kanpur', 'Agra', 'Varanasi', 'Meerut', 'Noida', 'Ghaziabad', 'Prayagraj', 'Bareilly'],
  Uttarakhand: ['Dehradun', 'Haridwar', 'Rishikesh', 'Nainital', 'Haldwani', 'Roorkee'],
  'West Bengal': ['Kolkata', 'Howrah', 'Durgapur', 'Asansol', 'Siliguri', 'Kharagpur'],
};

const VALID_PAYMENT_METHODS = ['Online', 'Cash', 'Cheque'];
const VALID_SOCIETY_TYPES = [
  'Apartment Complex',
  'Gated Community',
  'Township',
  'Co-operative Housing',
  'Villa Society',
  'Other',
];
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const PINCODE_RE = /^\d{6}$/;
const LOGO_DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/;

function isValidStateCity(state, city) {
  const cities = INDIA_STATES_CITIES[state];
  if (!cities) return false;
  return cities.includes(city);
}

function validateSocietyLogo(society_logo) {
  if (!society_logo || typeof society_logo !== 'string') {
    return { ok: false, error: 'Society logo image is required' };
  }

  const match = LOGO_DATA_URL_RE.exec(society_logo);
  if (!match) {
    return { ok: false, error: 'Society logo must be a JPG, PNG, WebP, or GIF image' };
  }

  const [, mimeType, b64] = match;
  if (!b64) return { ok: false, error: 'Society logo is empty' };

  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  const bytes = Math.floor((b64.length * 3) / 4) - padding;
  if (bytes > MAX_LOGO_BYTES) {
    return { ok: false, error: 'Society logo must be 2 MB or smaller' };
  }

  const buffer = Buffer.from(b64, 'base64');
  const validSignature = {
    'image/png': () => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'image/jpeg': () => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
    'image/gif': () => buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii')),
    'image/webp': () => buffer.length >= 12
      && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
      && buffer.subarray(8, 12).toString('ascii') === 'WEBP',
  }[mimeType]?.();

  if (!validSignature) {
    return { ok: false, error: 'Society logo is not a valid image file' };
  }

  return { ok: true };
}

/**
 * Accepts payment_methods: string[] (preferred) or legacy payment_method string.
 * Returns { ok, error?, value } where value is a comma-separated canonical string.
 */
function normalizePaymentMethods(body) {
  let raw = body.payment_methods;
  if (raw == null && body.payment_method != null) {
    // Legacy single string — map old labels where possible
    const legacy = String(body.payment_method).trim();
    const legacyMap = {
      Cash: ['Cash'],
      Cheque: ['Cheque'],
      Online: ['Online'],
      'Payment Gateway': ['Online'],
      'Online (Payment Gateway)': ['Online'],
      'Cash Only': ['Cash'],
      'Both Cash & Online': ['Cash', 'Online'],
      'Cheque & Online': ['Cheque', 'Online'],
      'Transaction Receipt': [],
    };
    raw = legacyMap[legacy] ?? legacy.split(',').map((s) => s.trim()).filter(Boolean);
  }

  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: 'Select at least one payment method (Online, Cash, or Cheque)' };
  }

  const normalized = [];
  for (const item of raw) {
    const key = String(item).trim();
    if (!VALID_PAYMENT_METHODS.includes(key)) {
      return { ok: false, error: `Invalid payment method: ${key}` };
    }
    if (!normalized.includes(key)) normalized.push(key);
  }

  if (normalized.length === 0) {
    return { ok: false, error: 'Select at least one payment method (Online, Cash, or Cheque)' };
  }

  return { ok: true, value: normalized.join(', ') };
}

/**
 * Validates shared society inquiry fields for authenticated + public submission.
 * Returns null on success, or an error message string.
 */
function validateSocietyInquiryFields(body, { requireLogo = true } = {}) {
  const {
    society_type,
    society_name,
    total_wings,
    state,
    city,
    pincode,
    address,
    late_fee,
    payment_tc,
    society_logo,
    user_phone,
  } = body;

  const phone = String(user_phone || '').trim();
  if (!phone) return 'Mobile number is required';
  if (!isValidPhone(phone)) {
    return 'Mobile number must be a valid 10-digit Indian mobile number';
  }

  if (!society_name?.trim()) return 'Society name is required';
  if (society_name.trim().length > 100) return 'Society name must not exceed 100 characters';
  if (!society_type || !VALID_SOCIETY_TYPES.includes(society_type)) {
    return 'A valid society type is required';
  }
  if (total_wings === undefined || total_wings === null || total_wings === '') {
    return 'Total wings is required';
  }
  const w = Number(total_wings);
  if (isNaN(w) || w < 1 || w > 100) return 'Total wings must be between 1 and 100';
  if (!pincode?.trim() || !PINCODE_RE.test(pincode.trim())) {
    return 'Pincode must be exactly 6 digits';
  }
  if (!state?.trim() || !city?.trim()) return 'State and city are required';
  if (!isValidStateCity(state.trim(), city.trim())) {
    return 'Select a valid city for the chosen state';
  }
  if (!address?.trim()) return 'Full address is required';
  if (!/[A-Za-z]/.test(address.trim())) {
    return 'Full address must include letters and cannot contain only numbers';
  }

  if (late_fee !== undefined && late_fee !== null && late_fee !== '') {
    const f = Number(late_fee);
    if (isNaN(f) || f < 0) return 'Late fee must be a non-negative number';
  }
  if (payment_tc && payment_tc.length > 1000) return 'Payment T&C must not exceed 1000 characters';

  if (requireLogo) {
    const logoCheck = validateSocietyLogo(society_logo);
    if (!logoCheck.ok) return logoCheck.error;
  }

  return null;
}

module.exports = {
  INDIA_STATES_CITIES,
  VALID_PAYMENT_METHODS,
  VALID_SOCIETY_TYPES,
  PINCODE_RE,
  isValidStateCity,
  validateSocietyLogo,
  normalizePaymentMethods,
  validateSocietyInquiryFields,
};
