const { logActivity, logError } = require('../utils/activityLogger');

// Map route prefixes → module names
const MODULE_MAP = {
  '/auth':          'auth',
  '/buildings':     'buildings',
  '/maintenance':   'maintenance',
  '/complaints':    'complaints',
  '/visitors':      'visitors',
  '/vehicles':      'vehicles',
  '/meetings':      'meetings',
  '/chat':          'chat',
  '/funds':         'funds',
  '/requests':      'requests',
  '/announcements': 'announcements',
  '/notifications': 'notifications',
  '/subscriptions': 'subscriptions',
  '/helpline':      'helpline',
  '/expenses':      'expenses',
  '/promos':        'promos',
  '/inquiries':     'inquiries',
};

// Map HTTP method + path patterns → human-readable action labels
function resolveAction(method, path) {
  const p = path.toLowerCase();

  // Auth
  if (p.includes('/login'))           return 'login';
  if (p.includes('/signup'))          return 'signup';
  if (p.includes('/logout'))          return 'logout';
  if (p.includes('/forgot-password')) return 'forgot_password';
  if (p.includes('/reset-password'))  return 'reset_password';
  if (p.includes('/profile'))         return 'update_profile';
  if (p.includes('/push-token'))      return 'register_push_token';

  // Maintenance
  if (p.includes('/maintenance/bills') && method === 'POST')   return 'create_bill';
  if (p.includes('/maintenance/bills') && method === 'PATCH')  return 'update_bill';
  if (p.includes('/maintenance/pay/order'))                    return 'initiate_payment';
  if (p.includes('/maintenance/pay/verify'))                   return 'verify_payment';
  if (p.includes('/maintenance/reminder'))                     return 'send_reminder';
  if (p.includes('/maintenance/receipt'))                      return 'download_receipt';

  // Complaints
  if (p.includes('/complaints') && method === 'POST' && !p.includes('/admin'))  return 'create_complaint';
  if (p.includes('/complaints') && method === 'PATCH')                          return 'update_complaint_status';
  if (p.includes('/complaints/admin') && method === 'PUT')                      return 'admin_update_complaint';
  if (p.includes('/complaints/admin') && method === 'DELETE')                   return 'admin_delete_complaint';
  if (p.includes('/complaints/admin') && method === 'POST')                     return 'admin_create_complaint';

  // Buildings / members
  if (p.includes('/buildings/join/handle'))  return 'handle_join_request';
  if (p.includes('/buildings/join'))         return 'request_join_building';
  if (p.includes('/buildings/pramukh'))      return 'create_pramukh';
  if (p.includes('/buildings/create'))       return 'create_building';
  if (p.includes('/buildings/bank-details') && method !== 'GET') return 'update_bank_details';
  if (p.includes('/admin/users') && method === 'DELETE') return 'admin_delete_user';
  if (p.includes('/admin/users') && method === 'POST')   return 'admin_create_user';

  // Vehicles
  if (p.includes('/vehicles/report'))    return 'report_parking';
  if (p.includes('/vehicles/reminder'))  return 'send_parking_reminder';
  if (p.includes('/vehicles') && method === 'POST')   return 'add_vehicle';
  if (p.includes('/vehicles') && method === 'DELETE') return 'delete_vehicle';
  if (p.includes('/vehicles') && method === 'PATCH')  return 'update_vehicle';

  // Visitors
  if (p.includes('/visitors') && method === 'POST') return 'log_visitor';

  // Meetings
  if (p.includes('/meetings') && method === 'POST') return 'create_meeting';

  // Chat
  if (p.includes('/chat') && method === 'POST') return 'send_message';

  // Funds
  if (p.includes('/funds') && method === 'POST') return 'update_fund';

  // Announcements
  if (p.includes('/announcements') && method === 'POST')   return 'create_announcement';
  if (p.includes('/announcements') && method === 'DELETE') return 'delete_announcement';

  // Subscriptions
  if (p.includes('/subscriptions') && p.includes('/grant'))  return 'admin_grant_subscription';
  if (p.includes('/subscriptions') && p.includes('/revoke')) return 'admin_revoke_subscription';
  if (p.includes('/subscriptions') && p.includes('/order'))  return 'create_subscription_order';
  if (p.includes('/subscriptions') && p.includes('/verify')) return 'verify_subscription';

  // Expenses
  if (p.includes('/expenses') && method === 'POST')   return 'add_expense';
  if (p.includes('/expenses') && method === 'DELETE') return 'delete_expense';
  if (p.includes('/expenses') && method === 'PATCH')  return 'update_expense';

  // Requests
  if (p.includes('/requests') && method === 'POST')  return 'submit_request';
  if (p.includes('/requests/status'))                return 'update_request_status';

  // Inquiries
  if (p.includes('/inquiries') && method === 'POST')  return 'submit_inquiry';
  if (p.includes('/inquiries') && p.includes('/status')) return 'update_inquiry_status';

  // Promos
  if (p.includes('/promos') && method === 'POST')   return 'create_promo';
  if (p.includes('/promos') && method === 'DELETE') return 'delete_promo';

  // Generic fallback
  const methodMap = { POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' };
  return methodMap[method] || method.toLowerCase();
}

// Endpoints we never log against — would either cause loops (activity-logs
// itself) or be pure noise (health checks, push-token registrations).
const SKIP_MODULES = new Set(['activity-logs', 'health', 'app-config']);

function resolveModule(path) {
  for (const [prefix, name] of Object.entries(MODULE_MAP)) {
    if (path.toLowerCase().includes(prefix)) return name;
  }
  // Fall back to the first non-empty path segment so errors from newer
  // endpoints (e.g. /newspapers, /refer, /society-rules) still surface.
  const seg = path.replace(/^\/+/, '').split('/')[0]?.toLowerCase() || '';
  if (!seg || SKIP_MODULES.has(seg)) return 'unknown';
  return seg;
}

// Build the request-detail object once: shared by both success and error logs.
function buildRequestDetail(req) {
  const SENSITIVE = ['password', 'password_hash', 'token', 'secret', 'otp', 'razorpay_signature', 'hash', 'easebuzz_hash'];
  const detail = {};
  if (req.body && typeof req.body === 'object') {
    for (const [k, v] of Object.entries(req.body)) {
      if (SENSITIVE.includes(k.toLowerCase())) continue;
      if (typeof v === 'string' && v.startsWith('data:image')) {
        detail[k] = '[image attached]';
      } else {
        detail[k] = typeof v === 'string' && v.length > 300 ? v.slice(0, 300) + '…' : v;
      }
    }
  }
  if (req.params && Object.keys(req.params).length) detail._params = req.params;
  if (req.query && Object.keys(req.query).length) {
    const safeQuery = { ...req.query };
    delete safeQuery.token;
    if (Object.keys(safeQuery).length) detail._query = safeQuery;
  }
  return detail;
}

/**
 * Express middleware — logs user/pramukh activity to the audit table.
 *
 * Logging policy (admin-readable):
 *   • 2xx mutating request → level: 'info'  (existing audit trail)
 *   • 5xx response         → level: 'error' (technical failure — admin must see)
 *   • 4xx response         → SKIPPED        (validation / auth / not-found —
 *                                            user input issues, not bugs)
 *   • Admin role / unknown module → never logged
 *
 * Response body for failed requests is captured by wrapping res.json once,
 * so the controller's `{ error: '...' }` message ends up in the log without
 * touching individual controllers.
 */
function activityLogMiddleware(req, res, next) {
  // Wrap res.json so we can keep a copy of whatever the controller sent back.
  // Used only on error paths — for 2xx we never read it, so cost is negligible.
  const originalJson = res.json.bind(res);
  res.json = function capturedJson(body) {
    res._capturedBody = body;
    return originalJson(body);
  };

  res.on('finish', () => {
    if (!req.user || req.user.role === 'admin') return;

    const status = res.statusCode;
    const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);

    // Only two cases produce a log row:
    //   1. Successful mutation (2xx/3xx, mutating method) — info level
    //   2. Server error (5xx, ANY method including GET) — error level
    // Everything else (4xx, GET 2xx) is dropped to keep the table small
    // and the admin dashboard signal-rich.
    const isSuccessMutation = status < 400 && isMutation;
    const isServerError = status >= 500;
    if (!isSuccessMutation && !isServerError) return;

    const module = resolveModule(req.path);
    if (module === 'unknown') return; // skip activity-logs itself, health checks, etc.

    const action = resolveAction(req.method, req.path);
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    const detail = buildRequestDetail(req);
    detail.path = req.originalUrl || req.path;
    detail.method = req.method;
    detail.status_code = status;

    if (isServerError) {
      // Pull the controller's error message out of the captured response body.
      const body = res._capturedBody;
      const msg =
        (body && typeof body === 'object' && (body.error || body.message)) ||
        (typeof body === 'string' ? body.slice(0, 500) : null) ||
        'Server error';
      detail.error_message = String(msg).slice(0, 500);
      logError(req.user, action, module, detail, ip);
    } else {
      logActivity(req.user, action, module, detail, ip);
    }
  });

  next();
}

module.exports = activityLogMiddleware;
