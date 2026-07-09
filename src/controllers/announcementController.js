const supabase = require('../supabase');
const ns = require('../utils/notificationService');
const { createCopy } = require('../utils/notificationCopy');

const VALID_PRIORITIES = ['normal', 'urgent'];

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

  const { data, error } = await supabase
    .from('announcements')
    .insert({
      building_id,
      title: title.trim(),
      body: body.trim(),
      priority: priority || 'normal',
      created_by: req.user.id
    })
    .select().single();

  if (error) return res.status(400).json({ error: error.message });

  await ns.notifyMembers(building_id, {
    type: priority === 'urgent' ? 'announcement_urgent' : 'announcement',
    meta: { announcement_id: data.id, priority: priority || 'normal' },
    build: (lang) => createCopy(lang).announcement(title.trim(), body.trim(), priority === 'urgent'),
  }, null, req.user.id);

  res.status(201).json({ message: 'Announcement posted', announcement: data });
};

// Get announcements for building
exports.getAnnouncements = async (req, res) => {
  const building_id = req.user.building_id || req.query.building_id;

  // Admin with no building: return all announcements across all buildings
  if (!building_id) {
    if (req.user.role === 'admin') {
      const { data, error } = await supabase
        .from('announcements')
        .select('*, users(name)')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) return res.status(400).json({ error: error.message });
      return res.json(data);
    }
    return res.status(400).json({ error: 'You must be part of a building' });
  }

  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;

  const { data, error } = await supabase
    .from('announcements')
    .select('*, users(name)')
    .eq('building_id', building_id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};
