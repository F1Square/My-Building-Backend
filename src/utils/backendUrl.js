/**
 * Resolve the backend base URL to use in payment-gateway callback URLs.
 *
 * Strategy (in order of preference):
 *   1. If the request carries a usable Host header, derive the URL from the
 *      request itself. This works equally well for:
 *        - local dev (http://10.10.8.102:5000)
 *        - Vercel / Render / any HTTPS-fronted deployment, because we
 *          enabled `app.set('trust proxy', true)` and Express then honours
 *          X-Forwarded-Proto / X-Forwarded-Host.
 *   2. Fall back to process.env.BACKEND_URL only if the request didn't
 *      provide a host (defensive — should never happen in normal use).
 *
 * This eliminates the bug where dev callbacks were redirecting to the
 * production Vercel URL because the previous code branched on NODE_ENV
 * and required BACKEND_URL to be perfectly aligned across environments.
 */
function getBackendUrl(req) {
  const host = req?.get?.('host');
  if (host) {
    const proto = req.protocol || 'https';
    return `${proto}://${host}`.replace(/\/+$/, '');
  }
  const fromEnv = process.env.BACKEND_URL;
  if (fromEnv) return String(fromEnv).replace(/\/+$/, '');
  return null;
}

function isPrivateHost(hostname) {
  if (!hostname) return false;
  const h = String(hostname).toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
  if (/^10\.\d+\.\d+\.\d+$/.test(h)) return true;
  if (/^192\.168\.\d+\.\d+$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(h)) return true;
  return false;
}

/** Easebuzz must reach surl/furl over the public internet — LAN IPs fail validation. */
function getPaymentCallbackUrl(req) {
  const explicit = process.env.EASEBUZZ_CALLBACK_URL || process.env.PAYMENT_CALLBACK_URL;
  if (explicit) return String(explicit).replace(/\/+$/, '');

  const hostHeader = req?.get?.('host') || '';
  const hostname = hostHeader.split(':')[0];
  const backendFromEnv = process.env.BACKEND_URL
    ? String(process.env.BACKEND_URL).replace(/\/+$/, '')
    : null;

  if (isPrivateHost(hostname) && backendFromEnv?.startsWith('https://')) {
    return backendFromEnv;
  }

  return getBackendUrl(req);
}

module.exports = { getBackendUrl, getPaymentCallbackUrl };
