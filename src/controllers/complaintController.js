const supabase = require('../supabase');
const { uploadImage } = require('../utils/imageUploadHelper');
const ns = require('../utils/notificationService');
const { createCopy } = require('../utils/notificationCopy');
const { userDisplayName, mapComplaint, mapComplaints } = require('../utils/userDisplayName');

const USER_FIELDS = 'name, email, flat_no, wing';

// Upload complaint attachment to Cloudinary
exports.uploadComplaintAttachment = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        error: 'No attachment provided',
        code: 'MISSING_FILE'
      });
    }

    // Upload image to Cloudinary
    const result = await uploadImage(req.file.buffer, {
      folder: 'complaints'
    });

    res.json({
      success: true,
      photo_url: result.secure_url,
      public_id: result.public_id,
      width: result.width,
      height: result.height,
      format: result.format
    });
  } catch (error) {
    console.error('Complaint attachment upload error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to upload attachment',
      code: 'UPLOAD_FAILED'
    });
  }
};

// User/Pramukh: create a complaint
exports.createComplaint = async (req, res) => {
  const { title, description, category, photo_url } = req.body;
  const user_id = req.user.id;
  const building_id = req.user.building_id;

  if (!title?.trim()) return res.status(422).json({ error: 'Title is required' });
  if (!building_id) return res.status(400).json({ error: 'You must be part of a building to raise a complaint' });

  let finalPhotoUrl = photo_url;
  if (photo_url && photo_url.startsWith('data:image')) {
    try {
      const uploadRes = await uploadImage(photo_url, { folder: 'complaints' });
      finalPhotoUrl = uploadRes.secure_url;
    } catch (err) {
      console.error('Complaint auto-upload failed:', err);
      // Fallback to original url if upload fails (though it might be a large string)
    }
  }

  const { data, error } = await supabase
    .from('complaints')
    .insert({ user_id, building_id, title: title.trim(), description: description?.trim(), category, photo_url: finalPhotoUrl })
    .select(`*, users(${USER_FIELDS})`)
    .single();

  if (error) return res.status(400).json({ error: error.message });

  const reporterName = userDisplayName(data.users);

  // Notify members and pramukh
  await ns.notifyMembers(building_id, {
    type: 'complaint',
    meta: { complaint_id: data.id },
    build: (lang) => {
      const c = createCopy(lang);
      return c.complaintNew(reporterName, c.residentFlatLabel(data.users), title.trim());
    },
  });

  res.status(201).json({ message: 'Complaint submitted', complaint: mapComplaint(data) });
};

// User: get only their own complaints
exports.getMyComplaints = async (req, res) => {
  const { status } = req.query;
  let query = supabase
    .from('complaints')
    .select('id, user_id, building_id, title, description, category, status, remark, created_at, updated_at')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });

  if (status && status !== 'all') query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};

// Pramukh: get all complaints for their building
exports.getBuildingComplaints = async (req, res) => {
  const { status } = req.query;
  const building_id = req.user.building_id;
  if (!building_id) return res.status(400).json({ error: 'No building assigned' });

  let query = supabase
    .from('complaints')
    .select(`id, user_id, building_id, title, description, category, status, remark, created_at, updated_at, users(${USER_FIELDS})`)
    .eq('building_id', building_id)
    .order('created_at', { ascending: false });

  if (status && status !== 'all') query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json(mapComplaints(data));
};

// Get a single complaint by id (detail view — avoids passing large payloads via navigation)
exports.getComplaintById = async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from('complaints')
    .select(`*, users(${USER_FIELDS}), buildings(name)`)
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

// Pramukh: update status + remark
exports.updateComplaintStatus = async (req, res) => {
  const { id } = req.params;
  const { status, remark } = req.body;

  const VALID = ['open', 'in_progress', 'resolved'];
  if (!VALID.includes(status)) return res.status(422).json({ error: 'Invalid status' });

  const { data: existing } = await supabase.from('complaints').select('building_id').eq('id', id).single();
  if (!existing) return res.status(404).json({ error: 'Complaint not found' });
  if (req.user.role === 'pramukh' && existing.building_id !== req.user.building_id)
    return res.status(403).json({ error: 'Access denied' });

  const { data, error } = await supabase
    .from('complaints')
    .update({ status, remark: remark?.trim() || null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(`*, users(${USER_FIELDS})`)
    .single();

  if (error) return res.status(400).json({ error: error.message });

  // Same pattern as createComplaint — in-app + push to all approved members
  const { data: updater } = await supabase
    .from('users')
    .select('name, email')
    .eq('id', req.user.id)
    .single();
  const updaterName = userDisplayName(updater || req.user, 'Pramukh');

  await ns.notifyMembers(data.building_id, {
    type: 'complaint',
    meta: { complaint_id: data.id, status },
    build: (lang) => createCopy(lang).complaintStatusUpdate(data.title, status, updaterName),
  });

  res.json({ message: 'Status updated', complaint: mapComplaint(data) });
};

// Admin: get all complaints, optionally filtered by building
exports.adminGetComplaints = async (req, res) => {
  const { building_id, status } = req.query;

  let query = supabase
    .from('complaints')
    .select(`id, user_id, building_id, title, description, category, status, remark, created_at, updated_at, users(${USER_FIELDS}), buildings(name)`)
    .order('created_at', { ascending: false });

  if (building_id) query = query.eq('building_id', building_id);
  if (status && status !== 'all') query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json(mapComplaints(data));
};

// Admin: update any complaint
exports.adminUpdateComplaint = async (req, res) => {
  const { id } = req.params;
  const { title, description, category, status, remark, photo_url } = req.body;

  const updates = { updated_at: new Date().toISOString() };
  if (title) updates.title = title.trim();
  if (description !== undefined) updates.description = description?.trim();
  if (category !== undefined) updates.category = category;
  if (status) updates.status = status;
  if (remark !== undefined) updates.remark = remark?.trim() || null;
  if (photo_url !== undefined) updates.photo_url = photo_url;

  const { data, error } = await supabase
    .from('complaints')
    .update(updates)
    .eq('id', id)
    .select(`*, users(${USER_FIELDS}), buildings(name)`)
    .single();

  if (error) return res.status(400).json({ error: error.message });

  if (status && data?.building_id) {
    const { data: updater } = await supabase
      .from('users')
      .select('name, email')
      .eq('id', req.user.id)
      .single();
    const updaterName = userDisplayName(updater || req.user, 'Admin');

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
  if (!title?.trim()) return res.status(422).json({ error: 'Title is required' });
  if (!building_id) return res.status(422).json({ error: 'building_id is required' });

  const { data, error } = await supabase
    .from('complaints')
    .insert({ title: title.trim(), description: description?.trim(), category, photo_url, building_id, user_id: user_id || null })
    .select(`*, users(${USER_FIELDS}), buildings(name)`)
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ message: 'Complaint created', complaint: mapComplaint(data) });
};
