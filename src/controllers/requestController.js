const supabase = require('../supabase');
const ns = require('../utils/notificationService');

// User: submit maintenance request
exports.submitRequest = async (req, res) => {
  const { title, description, category } = req.body;
  const { id: user_id, building_id, name } = req.user;
  if (!title?.trim()) return res.status(422).json({ error: 'Title is required' });
  if (title.trim().length > 150) return res.status(422).json({ error: 'Title must not exceed 150 characters' });
  if (description && description.trim().length > 2000) return res.status(422).json({ error: 'Description must not exceed 2000 characters' });
  if (category && category.trim().length > 100) return res.status(422).json({ error: 'Category must not exceed 100 characters' });

  const { data, error } = await supabase
    .from('maintenance_requests')
    .insert({ user_id, building_id, title, description, category, status: 'open' })
    .select().single();

  if (error) return res.status(400).json({ error: error.message });

  await ns.notifyMembersExcept(building_id, user_id, {
    title: 'New Maintenance Request',
    body: `${name} submitted: ${title}`,
    type: 'maintenance_request',
    meta: { request_id: data.id }
  });

  res.status(201).json({ message: 'Request submitted', request: data });
};

// Get all requests for building
exports.getRequests = async (req, res) => {
  const building_id = req.user.building_id;
  if (!building_id) return res.status(400).json({ error: 'You must be part of a building' });

  const { data, error } = await supabase
    .from('maintenance_requests')
    .select('*, users(name, flat_no)')
    .eq('building_id', building_id)
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};

// Pramukh: update request status
exports.updateRequestStatus = async (req, res) => {
  const { request_id, status, remark } = req.body;
  if (!request_id) return res.status(422).json({ error: 'request_id is required' });
  const VALID = ['open', 'in_progress', 'resolved'];
  if (!VALID.includes(status)) return res.status(422).json({ error: `status must be one of: ${VALID.join(', ')}` });

  const { data, error } = await supabase
    .from('maintenance_requests')
    .update({ status, remark, updated_at: new Date().toISOString() })
    .eq('id', request_id)
    .eq('building_id', req.user.building_id)
    .select().single();

  if (error || !data) return res.status(404).json({ error: 'Request not found' });

  await ns.notifyUser(data.user_id, {
    title: 'Request Update',
    body: `Your request "${data.title}" is now ${status.replace('_', ' ')}`,
    type: 'request_update',
    meta: { request_id }
  });

  res.json({ message: 'Status updated', request: data });
};
