const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const supabase = require('../supabase');
const { logActivity, logError } = require('../utils/activityLogger');
const { displayNameFromRaw } = require('../utils/userDisplayName');

/**
 * Frontend: log a client-side event (screen open, button tap, etc.).
 * Admins are skipped — we only audit users / pramukhs.
 */
router.post('/event', authenticate, async (req, res) => {
  if (req.user.role === 'admin') return res.json({ ok: true });

  const { action, module, detail } = req.body;
  if (!action) return res.status(422).json({ error: 'action is required' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
  await logActivity(req.user, action, module || 'app', detail || {}, ip, 'info');
  res.json({ ok: true });
});

/**
 * Frontend: report a client-side technical error (5xx, network failure,
 * unhandled JS exception, etc.). The mobile app's axios interceptor calls
 * this automatically — see My_Building/utils/api.ts.
 *
 * Validation errors (4xx) MUST NOT be sent here — they're expected user-input
 * problems and would only spam the table.
 */
router.post('/error', authenticate, async (req, res) => {
  if (req.user.role === 'admin') return res.json({ ok: true });

  const { action, module, detail } = req.body;
  // Soft-validate: anything posted here is captured even if action missing,
  // so a half-broken client can still surface the error.
  const safeAction = (typeof action === 'string' && action.trim()) || 'client_error';
  const safeModule = (typeof module === 'string' && module.trim()) || 'app';

  const enriched = (detail && typeof detail === 'object') ? { ...detail } : {};
  // Truncate strings to keep rows lightweight.
  for (const [k, v] of Object.entries(enriched)) {
    if (typeof v === 'string' && v.length > 800) enriched[k] = v.slice(0, 800) + '…';
  }
  enriched.source = 'client';

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
  await logError(req.user, safeAction, safeModule, enriched, ip);
  res.json({ ok: true });
});

/**
 * Admin: list logs — newest first, paginated.
 * Filters:
 *   - date=YYYY-MM-DD    only entries from this day
 *   - level=error|info   filter by severity (default = both)
 *   - search=<text>      ILIKE on user_name, action, module
 */
router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  const { limit = 100, offset = 0, date, level, search } = req.query;

  let query = supabase
    .from('user_activity_logs')
    .select('*', { count: 'exact' })
    .in('user_role', ['user', 'pramukh'])
    .order('created_at', { ascending: false })
    .range(Number(offset), Number(offset) + Number(limit) - 1);

  if (date) {
    query = query
      .gte('created_at', `${date}T00:00:00.000Z`)
      .lte('created_at', `${date}T23:59:59.999Z`);
  }

  if (level === 'error' || level === 'info') {
    // detail is JSONB; supabase-js exposes the ->> operator via filter.
    query = query.filter('detail->>level', 'eq', level);
  }

  if (typeof search === 'string' && search.trim()) {
    const s = search.trim().replace(/[%,()]/g, ''); // light sanitization
    query = query.or(
      `user_name.ilike.%${s}%,action.ilike.%${s}%,module.ilike.%${s}%`
    );
  }

  const { data, error, count } = await query;
  if (error) return res.status(400).json({ error: error.message });
  const logs = (data || []).map((row) => ({
    ...row,
    user_name: displayNameFromRaw(row.user_name),
  }));
  res.json({ logs, total: count || 0 });
});

module.exports = router;
