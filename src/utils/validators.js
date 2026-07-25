/**
 * Centralized validation utilities
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[6-9]\d{9}$/; // Indian mobile numbers
const VEHICLE_RE = /^[A-Z]{2}\d{2}[A-Z]{1,2}\d{4}$/; // e.g. GJ01AB1234

exports.isValidEmail = (v) => EMAIL_RE.test(v);
exports.isValidPhone = (v) => PHONE_RE.test(v);
exports.isValidVehicleNumber = (v) => VEHICLE_RE.test(v?.toUpperCase());

exports.validate = (rules) => (req, res, next) => {
  const errors = [];
  for (const [field, checks] of Object.entries(rules)) {
    const value = req.body[field];
    for (const check of checks) {
      const err = check(value, field);
      if (err) { errors.push(err); break; }
    }
  }
  if (errors.length) return res.status(422).json({ error: errors[0], errors });
  next();
};

// Reusable rule factories
exports.required = (field) => (v) => (!v && v !== 0) ? `${field} is required` : null;
exports.minLen = (n) => (v, field) => (v && v.length < n) ? `${field} must be at least ${n} characters` : null;
exports.maxLen = (n) => (v, field) => (v && v.length > n) ? `${field} must not exceed ${n} characters` : null;
exports.isEmail = (v, field) => (v && !EMAIL_RE.test(v)) ? `${field} must be a valid email` : null;
exports.isPhone = (v, field) => (v && !PHONE_RE.test(v)) ? `${field} must be a valid 10-digit Indian mobile number` : null;
exports.isPositive = (v, field) => (v !== undefined && (isNaN(v) || Number(v) <= 0)) ? `${field} must be a positive number` : null;
exports.inRange = (min, max) => (v, field) => (v !== undefined && (Number(v) < min || Number(v) > max)) ? `${field} must be between ${min} and ${max}` : null;
exports.isVehicle = (v, field) => (v && !VEHICLE_RE.test(v?.toUpperCase())) ? `${field} must be a valid vehicle number (e.g. GJ01AB1234)` : null;
exports.isFutureDate = (v, field) => (v && new Date(v) <= new Date()) ? `${field} must be a future date` : null;

/** Trim wing label — buildings always have named wings (A, B, …). */
exports.normalizeBankWing = (wing) => String(wing || '').trim();

/**
 * Exact wing bank row only (no Building-Wide fallback).
 * rows: [{ wing, ...bank fields }]
 */
exports.pickBankDetailsForWing = (rows, wing) => {
  const list = Array.isArray(rows) ? rows : [];
  const target = exports.normalizeBankWing(wing);
  if (!target) return null;
  return list.find((r) => exports.normalizeBankWing(r?.wing) === target) || null;
};

exports.isStrongPassword = (v, field) => {
  if (!v) return null;
  if (v.length < 8) return `${field || 'Password'} must be at least 8 characters`;
  if (!/[A-Z]/.test(v)) return `${field || 'Password'} must contain at least one uppercase letter`;
  if (!/[a-z]/.test(v)) return `${field || 'Password'} must contain at least one lowercase letter`;
  if (!/[0-9]/.test(v)) return `${field || 'Password'} must contain at least one digit`;
  if (!/[^A-Za-z0-9]/.test(v)) return `${field || 'Password'} must contain at least one special character`;
  return null;
};
exports.isUUID = (v, field) => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return (v && !UUID_RE.test(v)) ? `${field} must be a valid ID` : null;
};

/**
 * Safe list pagination from query params.
 * Defaults: limit 50, offset 0. Caps limit to avoid oversized reads.
 */
exports.parseListPagination = (query = {}, { defaultLimit = 50, maxLimit = 100 } = {}) => {
  let limit = parseInt(query.limit, 10);
  let offset = parseInt(query.offset, 10);
  if (!Number.isFinite(limit) || limit < 1) limit = defaultLimit;
  if (limit > maxLimit) limit = maxLimit;
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  return { limit, offset };
};
