const supabase = require('../supabase');

// Get notifications for logged-in user.
// Default: unread only. Pass ?recent=1 (or recent=true) for inbox: last 50
// regardless of read state (used by the home notification sheet).
exports.getNotifications = async (req, res) => {
  const recent =
    req.query.recent === '1' ||
    req.query.recent === 'true' ||
    req.query.include_read === '1';

  let q = supabase
    .from('notifications')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (!recent) {
    q = q.eq('is_read', false);
  }

  const { data, error } = await q;

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};

// Mark notification as read
exports.markRead = async (req, res) => {
  const { id } = req.params;
  await supabase.from('notifications').update({ is_read: true }).eq('id', id).eq('user_id', req.user.id);
  res.json({ message: 'Marked as read' });
};

// Mark all as read
exports.markAllRead = async (req, res) => {
  await supabase.from('notifications').update({ is_read: true }).eq('user_id', req.user.id);
  res.json({ message: 'All marked as read' });
};

// Mark all notifications of given types as read (called when user visits a module)
exports.markReadByTypes = async (req, res) => {
  const { types } = req.body; // array of type strings
  if (!Array.isArray(types) || !types.length)
    return res.status(422).json({ error: 'types array is required' });

  await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', req.user.id)
    .eq('is_read', false)
    .in('type', types);

  res.json({ message: 'Marked as read' });
};
// Delete all notifications of given types for this user (permanent dismiss)
exports.deleteByTypes = async (req, res) => {
  const { types } = req.body;
  if (!Array.isArray(types) || !types.length)
    return res.status(422).json({ error: 'types array is required' });

  await supabase
    .from('notifications')
    .delete()
    .eq('user_id', req.user.id)
    .in('type', types);

  res.json({ message: 'Dismissed' });
};

exports.getUnreadCounts = async (req, res) => {
  const { data, error } = await supabase
    .from('notifications')
    .select('type')
    .eq('user_id', req.user.id)
    .eq('is_read', false);

  if (error) return res.status(400).json({ error: error.message });

  /** Per-type counts from unread notification rows only */
  const counts = {};
  for (const n of data || []) {
    counts[n.type] = (counts[n.type] || 0) + 1;
  }

  /** Bell badge on home = unread rows only (not pending joins without a notification row) */
  const bell_unread = Object.values(counts).reduce((sum, n) => sum + n, 0);

  // For pramukh: inflate join_request for MODULE tile badges only (pending rows without notifications).
  // bell_unread stays notification-only so opening/closing the inbox clears the bell correctly.
  if (req.user.role === 'pramukh' && req.user.building_id) {
    const { count } = await supabase
      .from('join_requests')
      .select('id', { count: 'exact', head: true })
      .eq('building_id', req.user.building_id)
      .eq('status', 'pending');

    if (count > 0) {
      counts.join_request = Math.max(counts.join_request || 0, count);
    }
  }

  res.json({ counts, bell_unread });
};
