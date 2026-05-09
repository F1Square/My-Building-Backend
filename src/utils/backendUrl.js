/**
 * Resolve the backend base URL to use in payment-gateway callback URLs.
 *
 * Strategy (in order of preference):
 *   1. If the request carries a usable Host header, derive the URL from the
 *      request itself. This works equally well for:
 *        - local dev (http://10.10.4.75:5000)
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

module.exports = { getBackendUrl };
