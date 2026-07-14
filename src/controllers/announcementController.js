const supabase = require('../supabase');
const ns = require('../utils/notificationService');
const { createCopy } = require('../utils/notificationCopy');
const { userDisplayName, mapRowsWithDisplayUsers } = require('../utils/userDisplayName');
const { parseListPagination } = require('../utils/validators');

const VALID_PRIORITIES = ['normal', 'urgent'];

// Columns needed by list UI — avoid select('*') on hot path
const ANNOUNCEMENT_LIST_SELECT = 'id, building_id, title, body, priority, created_by, created_at, users(name, email)';

// Pramukh/Admin: add announcement
exports.addAnnouncement = async (req, res) => {
  const { title, body, priority } = req.body;
  const building_id = req.user.building_id || req.body.building_id;

  if (!building_id) return res.status(400).json({ error: 'building_id is required' });
  if (!title?.trim()) return res.status(422).json({ error: 'Title is required' });
  if (title.trim().length > 150) return res.status(422).json({ error: 'Title must not exceed 150 characters' });
  if (!body?.trim()) return res.status(422).json({ error: 'Body is required' });
  if (body.trim().length > 2000) return res.status(422).json({ error: 'Body must not exceed 2000 characters' });
  if (priority && !VALID_PRIORITIES.includes(priority)) return res.status(422).json({ error: 'priority must be normal or urgent' });

  const titleTrimmed = title.trim();
  const bodyTrimmed = body.trim();
  const resolvedPriority = priority || 'normal';

  const { data, error } = await supabase
    .from('announcements')
    .insert({
      building_id,
      title: titleTrimmed,
      body: bodyTrimmed,
      priority: resolvedPriority,
      created_by: req.user.id
    })
    .select('id, building_id, title, body, priority, created_by, created_at')
    .single();

  if (error) return res.status(400).json({ error: error.message });

  // Use JWT user — skip extra users round-trip for author name
  const authorName = userDisplayName(req.user, 'Pramukh');

  // notifyMembers only targets status=approved (pending/unapproved are excluded)
  await ns.notifyMembers(building_id, {
    type: resolvedPriority === 'urgent' ? 'announcement_urgent' : 'announcement',
    meta: { announcement_id: data.id, priority: resolvedPriority },
    build: (lang) => createCopy(lang).announcement(
      titleTrimmed,
      bodyTrimmed,
      resolvedPriority === 'urgent',
      authorName,
    ),
  });

  res.status(201).json({ message: 'Announcement posted', announcement: data });
};

// Get announcements for building — newest first, building-scoped, paginated
exports.getAnnouncements = async (req, res) => {
  const building_id = req.user.building_id || req.query.building_id;
  const { limit, offset } = parseListPagination(req.query);

  // Admin with no building: return newest across all buildings (capped)
  if (!building_id) {
    if (req.user.role === 'admin') {
      const { data, error } = await supabase
        .from('announcements')
        .select(ANNOUNCEMENT_LIST_SELECT)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) return res.status(400).json({ error: error.message });
      return res.json(mapRowsWithDisplayUsers(data ?? []));
    }
    return res.status(400).json({ error: 'You must be part of a building' });
  }

  const { data, error } = await supabase
    .from('announcements')
    .select(ANNOUNCEMENT_LIST_SELECT)
    .eq('building_id', building_id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return res.status(400).json({ error: error.message });
  res.json(mapRowsWithDisplayUsers(data ?? []));
};
