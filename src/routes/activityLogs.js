const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const supabase = require('../supabase');

// Frontend: log a client-side event (screen open, button tap, etc.)
router.post('/event', authenticate, async (req, res) => {
  // Never log admin actions
  if (req.user.role === 'admin') return res.json({ ok: true });

  const { action, module, detail } = req.body;
  if (!action) return res.status(422).json({ error: 'action is required' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;

  await supabase.from('user_activity_logs').insert({
    user_id:     req.user.id,
    user_name:   req.user.name,
    user_role:   req.user.role,
    building_id: req.user.building_id || null,
    action,
    module:      module || 'app',
    detail:      detail || {},
    ip_address:  ip,
  });

  res.json({ ok: true });
});

// Admin: get all logs — newest first, paginated, optional date filter
router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  const { limit = 100, offset = 0, date } = req.query;

  // Auto-purge logs older than 7 days
  supabase.from('user_activity_logs')
    .delete()
    .lt('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .then(() => {});

  let query = supabase
    .from('user_activity_logs')
    .select('*', { count: 'exact' })
    .in('user_role', ['user', 'pramukh'])
    .order('created_at', { ascending: false })
    .range(Number(offset), Number(offset) + Number(limit) - 1);

  // Filter by specific date (YYYY-MM-DD)
  if (date) {
    query = query
      .gte('created_at', `${date}T00:00:00.000Z`)
      .lte('created_at', `${date}T23:59:59.999Z`);
  }

  const { data, error, count } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json({ logs: data || [], total: count || 0 });
});

module.exports = router;
