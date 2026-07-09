const supabase = require('../supabase');
const ns = require('../utils/notificationService');
const { createCopy } = require('../utils/notificationCopy');

// Pramukh: schedule a meeting
exports.addMeeting = async (req, res) => {
  const { title, description, date_time, location } = req.body;
  const building_id = req.user.building_id;
  if (!title?.trim()) return res.status(422).json({ error: 'Title is required' });
  if (title.trim().length > 100) return res.status(422).json({ error: 'Title must not exceed 100 characters' });
  if (!date_time) return res.status(422).json({ error: 'date_time is required' });
  if (isNaN(Date.parse(date_time))) return res.status(422).json({ error: 'date_time must be a valid date' });
  if (new Date(date_time) <= new Date()) return res.status(422).json({ error: 'Meeting must be scheduled in the future' });
  if (description && description.length > 1000) return res.status(422).json({ error: 'Description must not exceed 1000 characters' });
  if (location && location.trim().length > 200) return res.status(422).json({ error: 'Location must not exceed 200 characters' });

  const { data, error } = await supabase
    .from('meetings')
    .insert({ building_id, title, description, date_time, location, created_by: req.user.id })
    .select().single();

  if (error) return res.status(400).json({ error: error.message });

  await ns.notifyMembers(building_id, {
    type: 'meeting',
    meta: { meeting_id: data.id },
    build: (lang) => createCopy(lang).meetingScheduled(title, date_time, location),
  });

  res.status(201).json({ message: 'Meeting scheduled', meeting: data });
};

// Get meetings for building
exports.getMeetings = async (req, res) => {
  const building_id = req.user.building_id;
  if (!building_id) return res.status(400).json({ error: 'You must be part of a building' });

  const { data, error } = await supabase
    .from('meetings')
    .select('*')
    .eq('building_id', building_id)
    .order('date_time', { ascending: true });

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};
