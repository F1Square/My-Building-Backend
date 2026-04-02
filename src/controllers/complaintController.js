const supabase = require('../supabase');
const ns = require('../utils/notificationService');

const VALID_STATUSES = ['open', 'in_progress', 'resolved'];

// User/Admin: submit complaint
exports.submitComplaint = async (req, res) => {
  const { title, description, category, photo_url } = req.body;
  const { id: user_id, name } = req.user;
  const building_id = req.user.building_id || req.body.building_id;

  if (!building_id) return res.status(400).json({ error: 'building_id is required' });
  if (!title?.trim()) return res.status(422).json({ error: 'Title is required' });
  if (title.trim().length > 150) return res.status(422).json({ error: 'Title must not exceed 150 characters' });
  if (description && description.trim().length > 2000) return res.status(422).json({ error: 'Description must not exceed 2000 characters' });
  if (category && category.trim().length > 100) return res.status(422).json({ error: 'Category must not exceed 100 characters' });

  const { data, error } = await supabase
    .from('complaints')
    .insert({ user_id, building_id, title: title.trim(), description: description?.trim(), category: category?.trim(), photo_url: photo_url || null, status: 'open' })
    .select().single();

  if (error) return res.status(400).json({ error: error.message });

  await ns.notifyPramukh(building_id, {
    title: 'New Complaint',
    body: `${name} filed a complaint: ${title}`,
    type: 'complaint',
    meta: { complaint_id: data.id }
  });

  res.status(201).json({ message: 'Complaint submitted', complaint: data });
};

// Get complaints for building
exports.getComplaints = async (req, res) => {
  const building_id = req.user.building_id || req.query.building_id;
  const mineOnly = req.query.mine === 'true';

  // Admin with no building: return all complaints
  if (!building_id) {
    if (req.user.role === 'admin') {
      const { data, error } = await supabase
        .from('complaints')
        .select('*, users!complaints_user_id_fkey(name, flat_no, role)')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) return res.status(400).json({ error: error.message });
      return res.json(data);
    }
    return res.status(400).json({ error: 'You must be part of a building' });
  }

  let query = supabase
    .from('complaints')
    .select('*, users!complaints_user_id_fkey(name, flat_no, role)')
    .eq('building_id', building_id)
    .order('created_at', { ascending: false })
    .limit(100);

  // Filter to own complaints only when ?mine=true is explicitly passed
  if (mineOnly) {
    query = query.eq('user_id', req.user.id);
  }

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};

// Pramukh/Admin: update complaint status
exports.updateComplaintStatus = async (req, res) => {
  const { complaint_id, status, remark } = req.body;

  if (!complaint_id) return res.status(422).json({ error: 'complaint_id is required' });
  if (!VALID_STATUSES.includes(status))
    return res.status(422).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });

  // Admin can update any complaint; pramukh only their building
  let query = supabase
    .from('complaints')
    .update({ status, remark: remark?.trim(), updated_at: new Date().toISOString() })
    .eq('id', complaint_id);

  if (req.user.role !== 'admin') {
    query = query.eq('building_id', req.user.building_id);
  }

  const { data, error } = await query.select().single();

  if (error || !data) return res.status(404).json({ error: 'Complaint not found' });

  await ns.notifyUser(data.user_id, {
    title: 'Complaint Update',
    body: `Your complaint "${data.title}" is now ${status.replace('_', ' ')}`,
    type: 'complaint_update',
    meta: { complaint_id }
  });

  res.json({ message: 'Status updated', complaint: data });
};

// Admin only: delete a complaint
exports.deleteComplaint = async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('complaints').delete().eq('id', id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Complaint deleted' });
};
