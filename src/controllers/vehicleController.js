const supabase = require('../supabase');
const ns = require('../utils/notificationService');

// Indian vehicle number: 2 letters + 2 digits + 1-3 letters + 4 digits  e.g. GJ05HR4533
const VEHICLE_RE = /^[A-Z]{2}\d{2}[A-Z]{1,3}\d{4}$/;
const VALID_TYPES = ['two_wheeler', 'four_wheeler'];

// Admin: edit any vehicle
exports.adminUpdateVehicle = async (req, res) => {
  const { id } = req.params;
  const { vehicle_number, vehicle_type } = req.body;

  const { data: vehicle } = await supabase.from('vehicles').select('id').eq('id', id).single();
  if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });

  const updates = {};
  if (vehicle_number) {
    const vNum = vehicle_number.toUpperCase().replace(/\s/g, '');
    if (!VEHICLE_RE.test(vNum)) return res.status(422).json({ error: 'Enter a valid vehicle number (e.g. GJ05HR4533)' });
    // Check uniqueness excluding this vehicle
    const { data: dup } = await supabase.from('vehicles').select('id').eq('vehicle_number', vNum).neq('id', id).single();
    if (dup) return res.status(409).json({ error: 'This vehicle number is already registered' });
    updates.vehicle_number = vNum;
  }
  if (vehicle_type) {
    if (!VALID_TYPES.includes(vehicle_type)) return res.status(422).json({ error: 'vehicle_type must be two_wheeler or four_wheeler' });
    updates.vehicle_type = vehicle_type;
  }

  const { data, error } = await supabase.from('vehicles').update(updates).eq('id', id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Vehicle updated', vehicle: data });
};

// Admin: delete any vehicle
exports.adminDeleteVehicle = async (req, res) => {
  const { id } = req.params;
  const { data: vehicle } = await supabase.from('vehicles').select('id').eq('id', id).single();
  if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
  const { error } = await supabase.from('vehicles').delete().eq('id', id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Vehicle deleted' });
};

// User: delete own vehicle
exports.deleteVehicle = async (req, res) => {
  const { id } = req.params;
  // Ensure user can only delete their own vehicle
  const { data: vehicle } = await supabase.from('vehicles').select('user_id').eq('id', id).single();
  if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
  if (vehicle.user_id !== req.user.id) return res.status(403).json({ error: 'Not your vehicle' });
  const { error } = await supabase.from('vehicles').delete().eq('id', id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Vehicle removed' });
};

// User: add vehicle
exports.addVehicle = async (req, res) => {
  const { vehicle_number, vehicle_type } = req.body;
  const { id: user_id, building_id } = req.user;
  if (!vehicle_number?.trim() || !vehicle_type) return res.status(400).json({ error: 'vehicle_number and vehicle_type are required' });
  if (!building_id) return res.status(400).json({ error: 'You must be part of a building' });
  if (!VALID_TYPES.includes(vehicle_type)) return res.status(422).json({ error: 'vehicle_type must be two_wheeler or four_wheeler' });
  const vNum = vehicle_number.toUpperCase().replace(/\s/g, '');
  if (!VEHICLE_RE.test(vNum)) return res.status(422).json({ error: 'Enter a valid vehicle number (e.g. GJ05HR4533)' });

  // Global uniqueness — vehicle number must be unique across all buildings
  const { data: existing } = await supabase.from('vehicles').select('id').eq('vehicle_number', vNum).single();
  if (existing) return res.status(409).json({ error: 'This vehicle number is already registered' });

  const { data, error } = await supabase
    .from('vehicles')
    .insert({ user_id, building_id, vehicle_number: vNum, vehicle_type })
    .select().single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ message: 'Vehicle added', vehicle: data });
};

// Get user's own vehicles
exports.getMyVehicles = async (req, res) => {
  const { data, error } = await supabase
    .from('vehicles').select('*').eq('user_id', req.user.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};

// Get all vehicles in building (with owner details, optional search)
exports.getBuildingVehicles = async (req, res) => {
  const building_id = req.user.building_id || req.query.building_id;
  const { vehicle_number } = req.query;

  // Admin with no building: return all vehicles
  if (!building_id) {
    if (req.user.role === 'admin') {
      const { data, error } = await supabase
        .from('vehicles')
        .select('*, users(id, name, flat_no, phone)')
        .order('created_at', { ascending: false });
      if (error) return res.status(400).json({ error: error.message });
      return res.json(data);
    }
    return res.status(400).json({ error: 'You must be part of a building' });
  }

  let query = supabase
    .from('vehicles')
    .select('*, users(id, name, flat_no, phone)')
    .eq('building_id', building_id);

  if (vehicle_number) query = query.ilike('vehicle_number', `%${vehicle_number.toUpperCase()}%`);

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};

// User/Pramukh/Admin: report parking misconduct
exports.reportParking = async (req, res) => {
  const { description, vehicle_number, location } = req.body;
  const { id: user_id, name } = req.user;
  const building_id = req.user.building_id || req.body.building_id;

  if (!building_id) return res.status(400).json({ error: 'building_id is required' });
  if (!description?.trim()) return res.status(422).json({ error: 'Description is required' });
  const wordCount = description.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount < 5) return res.status(422).json({ error: 'Description must be at least 5 words' });
  if (description.trim().length > 500) return res.status(422).json({ error: 'Description must not exceed 500 characters' });

  const { data, error } = await supabase
    .from('parking_reports')
    .insert({ user_id, building_id, description, vehicle_number, location, reported_by: name })
    .select().single();

  if (error) return res.status(400).json({ error: error.message });

  await ns.notifyPramukh(building_id, {
    title: '🚗 Parking Misconduct Reported',
    body: `${name} reported: ${description}${vehicle_number ? ` (${vehicle_number})` : ''}`,
    type: 'parking_report',
    meta: { report_id: data.id }
  });

  res.status(201).json({ message: 'Report submitted', report: data });
};

// Get parking reports
exports.getParkingReports = async (req, res) => {
  const building_id = req.user.building_id || req.query.building_id;

  // Admin with no building: return all reports
  if (!building_id) {
    if (req.user.role === 'admin') {
      const { data, error } = await supabase
        .from('parking_reports')
        .select('*, users(name)')
        .order('created_at', { ascending: false });
      if (error) return res.status(400).json({ error: error.message });
      return res.json(data);
    }
    return res.status(400).json({ error: 'You must be part of a building' });
  }

  const { data, error } = await supabase
    .from('parking_reports')
    .select('*, users(name)')
    .eq('building_id', building_id)
    .order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};

// Pramukh/Admin: send parking reminder to vehicle owner
exports.sendParkingReminder = async (req, res) => {
  const { vehicle_number, message } = req.body;
  const building_id = req.user.building_id || req.body.building_id;

  if (!vehicle_number?.trim()) return res.status(422).json({ error: 'vehicle_number is required' });
  if (message && message.trim().length > 500) return res.status(422).json({ error: 'Message must not exceed 500 characters' });

  let query = supabase
    .from('vehicles')
    .select('*, users(id, name)')
    .ilike('vehicle_number', vehicle_number.toUpperCase());

  if (building_id) query = query.eq('building_id', building_id);

  const { data: vehicle } = await query.single();

  if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });

  await ns.notifyUser(vehicle.users.id, {
    title: '🚗 Parking Reminder',
    body: message || `Your vehicle ${vehicle_number.toUpperCase()} is causing a parking issue. Please resolve it.`,
    type: 'parking_reminder',
    meta: { vehicle_number }
  });

  res.json({ message: `Reminder sent to ${vehicle.users.name}` });
};
