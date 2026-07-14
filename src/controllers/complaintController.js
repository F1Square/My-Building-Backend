const supabase = require('../supabase');
const { uploadImage } = require('../utils/imageUploadHelper');
const ns = require('../utils/notificationService');
const { createCopy } = require('../utils/notificationCopy');
const { userDisplayName, mapComplaint, mapComplaints } = require('../utils/userDisplayName');
const { parseListPagination } = require('../utils/validators');

const USER_FIELDS = 'name, email, flat_no, wing';
const VALID_STATUSES = ['open', 'in_progress', 'resolved'];
const VALID_CATEGORIES = ['General', 'Water', 'Electricity', 'Cleanliness', 'Security', 'Parking', 'Noise', 'Other'];

const COMPLAINT_LIST_SELECT = `id, user_id, building_id, title, description, category, status, remark, created_at, updated_at, users(${USER_FIELDS})`;
const COMPLAINT_MY_LIST_SELECT = 'id, user_id, building_id, title, description, category, status, remark, created_at, updated_at';
const COMPLAINT_DETAIL_SELECT = `id, user_id, building_id, title, description, category, photo_url, status, remark, created_at, updated_at, users(${USER_FIELDS}), buildings(name)`;
const COMPLAINT_ADMIN_LIST_SELECT = `id, user_id, building_id, title, description, category, status, remark, created_at, updated_at, users(${USER_FIELDS}), buildings(name)`;

async function resolveComplaintPhotoUrl(photo_url) {
  if (!photo_url) return null;
  if (!photo_url.startsWith('data:image')) return photo_url;
  try {
    const uploadRes = await uploadImage(photo_url, { folder: 'complaints' });
    return uploadRes.secure_url;
  } catch (err) {
    console.error('Complaint photo upload failed:', err.message || err);
    // Do not persist raw base64 — keeps DB/payload size bounded
    return null;
  }
}

function validateComplaintFields({ title, description, category, requireTitle = true }) {
  if (requireTitle && !title?.trim()) return 'Title is required';
  if (title != null && title.trim().length > 150) return 'Title must not exceed 150 characters';
  if (description != null && description.trim().length > 2000) return 'Description must not exceed 2000 characters';
  if (category != null && category !== '' && !VALID_CATEGORIES.includes(category)) {
    return `category must be one of: ${VALID_CATEGORIES.join(', ')}`;
  }
  return null;
}

// Upload complaint attachment to Cloudinary
exports.uploadComplaintAttachment = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No attachment provided',
        code: 'MISSING_FILE',
      });
    }

    const result = await uploadImage(req.file.buffer, {
      folder: 'complaints',
    });

    res.json({
      success: true,
      photo_url: result.secure_url,
      public_id: result.public_id,
      width: result.width,
      height: result.height,
      format: result.format,
    });
  } catch (error) {
    console.error('Complaint attachment upload error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to upload attachment',
      code: 'UPLOAD_FAILED',
    });
  }
};

// User/Pramukh: create a complaint
exports.createComplaint = async (req, res) => {
  const { title, description, category, photo_url } = req.body;
  const user_id = req.user.id;
  const building_id = req.user.building_id;

  if (!building_id) return res.status(400).json({ error: 'You must be part of a building to raise a complaint' });

  const fieldError = validateComplaintFields({ title, description, category });
  if (fieldError) return res.status(422).json({ error: fieldError });

  const finalPhotoUrl = await resolveComplaintPhotoUrl(photo_url);
  const titleTrimmed = title.trim();
  const resolvedCategory = category || 'General';

  const { data, error } = await supabase
    .from('complaints')
    .insert({
      user_id,
      building_id,
      title: titleTrimmed,
      description: description?.trim() || null,
      category: resolvedCategory,
      photo_url: finalPhotoUrl,
    })
    .select(COMPLAINT_DETAIL_SELECT)
    .single();

  if (error) return res.status(400).json({ error: error.message });

  const reporterName = userDisplayName(data.users || req.user);

  // Notify all approved building members (pending/unapproved excluded by notifyMembers)
  await ns.notifyMembers(building_id, {
    type: 'complaint',
    meta: { complaint_id: data.id },
    build: (lang) => {
      const c = createCopy(lang);
      return c.complaintNew(reporterName, c.residentFlatLabel(data.users), titleTrimmed);
    },
  });

  res.status(201).json({ message: 'Complaint submitted', complaint: mapComplaint(data) });
};

// User: get only their own complaints
exports.getMyComplaints = async (req, res) => {
  const { status } = req.query;
  const { limit, offset } = parseListPagination(req.query);

  let query = supabase
    .from('complaints')
    .select(COMPLAINT_MY_LIST_SELECT)
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status && status !== 'all') query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data ?? []);
};

// Pramukh/User: get all complaints for their building
exports.getBuildingComplaints = async (req, res) => {
  const { status } = req.query;
  const building_id = req.user.building_id;
  if (!building_id) return res.status(400).json({ error: 'No building assigned' });

  const { limit, offset } = parseListPagination(req.query);

  let query = supabase
    .from('complaints')
    .select(COMPLAINT_LIST_SELECT)
    .eq('building_id', building_id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status && status !== 'all') query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json(mapComplaints(data ?? []));
};

// Get a single complaint by id (detail view — includes photo_url)
exports.getComplaintById = async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from('complaints')
    .select(COMPLAINT_DETAIL_SELECT)
    .eq('id', id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Complaint not found' });

  const { role, id: userId, building_id } = req.user;

  if (role === 'admin') return res.json(mapComplaint(data));

  if (role === 'pramukh') {
    if (data.building_id !== building_id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    return res.json(mapComplaint(data));
  }

  // user: own complaint or any complaint in their building (society view)
  if (data.user_id === userId || data.building_id === building_id) {
    return res.json(mapComplaint(data));
  }

  return res.status(403).json({ error: 'Access denied' });
};

// Pramukh/Admin: update status + remark
exports.updateComplaintStatus = async (req, res) => {
  const { id } = req.params;
  const { status, remark } = req.body;

  if (!VALID_STATUSES.includes(status)) return res.status(422).json({ error: 'Invalid status' });

  const { data: existing } = await supabase
    .from('complaints')
    .select('building_id, user_id, title')
    .eq('id', id)
    .single();
  if (!existing) return res.status(404).json({ error: 'Complaint not found' });
  if (req.user.role === 'pramukh' && existing.building_id !== req.user.building_id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const { data, error } = await supabase
    .from('complaints')
    .update({ status, remark: remark?.trim() || null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(COMPLAINT_DETAIL_SELECT)
    .single();

  if (error) return res.status(400).json({ error: error.message });

  const updaterName = userDisplayName(req.user, req.user.role === 'admin' ? 'Admin' : 'Pramukh');

  await ns.notifyMembers(data.building_id, {
    type: 'complaint',
    meta: { complaint_id: data.id, status },
    build: (lang) => createCopy(lang).complaintStatusUpdate(data.title, status, updaterName),
  });

  res.json({ message: 'Status updated', complaint: mapComplaint(data) });
};

// Admin: get complaints — always paginated; optionally filtered by building
exports.adminGetComplaints = async (req, res) => {
  const { building_id, status } = req.query;
  const { limit, offset } = parseListPagination(req.query);

  let query = supabase
    .from('complaints')
    .select(COMPLAINT_ADMIN_LIST_SELECT)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (building_id) query = query.eq('building_id', building_id);
  if (status && status !== 'all') query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json(mapComplaints(data ?? []));
};

// Admin: update any complaint
exports.adminUpdateComplaint = async (req, res) => {
  const { id } = req.params;
  const { title, description, category, status, remark, photo_url } = req.body;

  const fieldError = validateComplaintFields({
    title,
    description,
    category,
    requireTitle: title !== undefined,
  });
  if (fieldError) return res.status(422).json({ error: fieldError });
  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return res.status(422).json({ error: 'Invalid status' });
  }

  const updates = { updated_at: new Date().toISOString() };
  if (title) updates.title = title.trim();
  if (description !== undefined) updates.description = description?.trim() || null;
  if (category !== undefined) updates.category = category || 'General';
  if (status) updates.status = status;
  if (remark !== undefined) updates.remark = remark?.trim() || null;
  if (photo_url !== undefined) {
    updates.photo_url = await resolveComplaintPhotoUrl(photo_url);
  }

  const { data, error } = await supabase
    .from('complaints')
    .update(updates)
    .eq('id', id)
    .select(COMPLAINT_DETAIL_SELECT)
    .single();

  if (error) return res.status(400).json({ error: error.message });

  if (status && data?.building_id) {
    const updaterName = userDisplayName(req.user, 'Admin');
    await ns.notifyMembers(data.building_id, {
      type: 'complaint',
      meta: { complaint_id: data.id, status },
      build: (lang) => createCopy(lang).complaintStatusUpdate(data.title, status, updaterName),
    });
  }

  res.json({ message: 'Complaint updated', complaint: mapComplaint(data) });
};

// Admin: delete a complaint
exports.adminDeleteComplaint = async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('complaints').delete().eq('id', id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Complaint deleted' });
};

// Admin: create a complaint on behalf
exports.adminCreateComplaint = async (req, res) => {
  const { title, description, category, photo_url, building_id, user_id } = req.body;

  const fieldError = validateComplaintFields({ title, description, category });
  if (fieldError) return res.status(422).json({ error: fieldError });
  if (!building_id) return res.status(422).json({ error: 'building_id is required' });

  const finalPhotoUrl = await resolveComplaintPhotoUrl(photo_url);

  const { data, error } = await supabase
    .from('complaints')
    .insert({
      title: title.trim(),
      description: description?.trim() || null,
      category: category || 'General',
      photo_url: finalPhotoUrl,
      building_id,
      user_id: user_id || null,
    })
    .select(COMPLAINT_DETAIL_SELECT)
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ message: 'Complaint created', complaint: mapComplaint(data) });
};
