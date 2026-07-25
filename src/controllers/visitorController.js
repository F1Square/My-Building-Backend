const supabase = require('../supabase');
const ns = require('../utils/notificationService');
const { createCopy } = require('../utils/notificationCopy');
const { uploadImage } = require('../utils/imageUploadHelper');
const { singleImageUpload, requireFile } = require('../middleware/imageUpload');
const { buildVisitorFlatLabels, resolveVisitorFlat, visitorNotifyRecipientIds } = require('../utils/flatMatchHelper');

/**
 * Load flat/wing from DB (JWT often omits wing) then build match labels.
 */
async function visitorFlatLabelsForUser(user) {
  if (!user?.id && !user?.flat_no) return [];

  let flat = String(user.flat_no || '').trim();
  let wing = String(user.wing || '').trim();

  if (user.id) {
    const { data } = await supabase
      .from('users')
      .select('flat_no, wing')
      .eq('id', user.id)
      .maybeSingle();
    if (data) {
      flat = String(data.flat_no || flat || '').trim();
      wing = String(data.wing || wing || '').trim();
    }
  }

  return buildVisitorFlatLabels(flat, wing);
}

async function loadBuildingPramukhIds(building_id) {
  const { data } = await supabase
    .from('users')
    .select('id')
    .eq('building_id', building_id)
    .eq('role', 'pramukh')
    .eq('status', 'approved');
  return data || [];
}

/** Notify only target-flat residents + society pramukhs (never other flats). */
async function notifyWatchmanVisitor(building_id, visitorId, name, flat_no, purpose) {
  const label = String(flat_no || '').trim();
  let wing = '';
  let flatNum = label;
  const dash = label.lastIndexOf('-');
  if (dash > 0) {
    wing = label.slice(0, dash).trim();
    flatNum = label.slice(dash + 1).trim() || label;
  }

  const { data: building } = await supabase
    .from('buildings')
    .select('id, has_wings, wings')
    .eq('id', building_id)
    .maybeSingle();

  let residents = [];
  if (building) {
    const resolved = await resolveVisitorFlat(
      supabase,
      building_id,
      building,
      wing || (building.has_wings ? null : ''),
      flatNum,
    );
    if (!resolved.error) residents = resolved.residents || [];
  }

  const pramukhs = await loadBuildingPramukhIds(building_id);
  const recipientIds = visitorNotifyRecipientIds(residents, pramukhs);
  if (!recipientIds.length) return;

  await ns.notifyMembers(
    building_id,
    {
      type: 'visitor',
      meta: { visitor_id: visitorId, flat_no: label },
      build: (lang) => createCopy(lang).visitorWatchman(name, flat_no, purpose),
    },
    recipientIds,
  );
}

// Upload visitor photo to Cloudinary
exports.uploadVisitorPhoto = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        error: 'No image file provided',
        code: 'MISSING_FILE'
      });
    }

    // Upload image to Cloudinary
    const result = await uploadImage(req.file.buffer, {
      folder: 'visitors'
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
    console.error('Visitor photo upload error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to upload photo',
      code: 'UPLOAD_FAILED'
    });
  }
};

// Watchman: log a visitor
exports.addVisitor = async (req, res) => {
  const { name, phone, purpose, flat_no, building_id, photo_url } = req.body;
  if (!name?.trim() || !building_id) return res.status(400).json({ error: 'Name and building_id are required' });
  if (name.trim().length > 100) return res.status(422).json({ error: 'Name must not exceed 100 characters' });
  if (!flat_no?.trim()) return res.status(422).json({ error: 'Flat number is required' });
  if (flat_no.trim().length > 20) return res.status(422).json({ error: 'Flat number must not exceed 20 characters' });
  if (phone && !/^[6-9]\d{9}$/.test(phone.trim())) return res.status(422).json({ error: 'Phone must be a valid 10-digit Indian mobile number' });
  if (purpose && purpose.trim().length > 500) return res.status(422).json({ error: 'Purpose must not exceed 500 characters' });

  let finalPhotoUrl = photo_url;
  if (photo_url && photo_url.startsWith('data:image')) {
    try {
      const uploadRes = await uploadImage(photo_url, { folder: 'visitors' });
      finalPhotoUrl = uploadRes.secure_url;
    } catch (err) {
      console.error('Visitor auto-upload failed:', err);
    }
  }

  const { data, error } = await supabase
    .from('visitors')
    .insert({ name, phone, purpose, flat_no, building_id, photo_url: finalPhotoUrl, logged_by: req.user.id, entry_type: 'watchman' })
    .select().single();

  if (error) return res.status(400).json({ error: error.message });

  try {
    await notifyWatchmanVisitor(building_id, data.id, name, flat_no, purpose);
  } catch (err) {
    console.error('Watchman visitor notify failed:', err.message || err);
  }

  res.status(201).json({ message: 'Visitor logged', visitor: data });
};

// Get visitors for a building — supports ?date=YYYY-MM-DD and ?building_id=
exports.getVisitors = async (req, res) => {
  const building_id = req.user.building_id || req.query.building_id;
  const { date } = req.query;
  const isUser = req.user.role === 'user';

  // Admin with no building: return all visitors
  if (!building_id) {
    if (req.user.role === 'admin') {
      let q = supabase.from('visitors').select('*').order('created_at', { ascending: false }).limit(500);
      if (date) {
        q = q.gte('created_at', `${date}T00:00:00.000Z`).lte('created_at', `${date}T23:59:59.999Z`);
      }
      const { data, error } = await q;
      if (error) return res.status(400).json({ error: error.message });
      return res.json(data);
    }
    return res.status(400).json({ error: 'building_id required' });
  }

  let q = supabase
    .from('visitors')
    .select('*')
    .eq('building_id', building_id)
    .order('created_at', { ascending: false })
    .limit(500);

  // Users only see visitors that came to their own flat (not other flats)
  if (isUser) {
    const flatLabels = await visitorFlatLabelsForUser(req.user);
    if (!flatLabels.length) return res.json([]);
    q = q.in('flat_no', flatLabels);
  }

  if (date) {
    q = q.gte('created_at', `${date}T00:00:00.000Z`).lte('created_at', `${date}T23:59:59.999Z`);
  }

  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};

// Get distinct dates that have visitors (for calendar dots)
exports.getVisitorDates = async (req, res) => {
  const building_id = req.user.building_id || req.query.building_id;
  const { month, year } = req.query;
  const isUser = req.user.role === 'user';

  if (!month || !year) return res.status(422).json({ error: 'month and year are required' });
  const m = parseInt(month), y = parseInt(year);
  if (isNaN(m) || m < 1 || m > 12) return res.status(422).json({ error: 'month must be between 1 and 12' });
  if (isNaN(y) || y < 2000 || y > 2100) return res.status(422).json({ error: 'year must be a valid year' });

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endMonth = parseInt(month) === 12 ? 1 : parseInt(month) + 1;
  const endYear = parseInt(month) === 12 ? parseInt(year) + 1 : parseInt(year);
  const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;

  let q = supabase
    .from('visitors')
    .select('created_at')
    .gte('created_at', `${startDate}T00:00:00.000Z`)
    .lt('created_at', `${endDate}T00:00:00.000Z`);

  if (building_id) q = q.eq('building_id', building_id);

  // Users only see dates for their own flat's visitors
  if (isUser) {
    const flatLabels = await visitorFlatLabelsForUser(req.user);
    if (!flatLabels.length) return res.json({ dates: [] });
    q = q.in('flat_no', flatLabels);
  }

  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });

  const dates = [...new Set(data.map((v) => v.created_at.slice(0, 10)))];
  res.json({ dates });
};
