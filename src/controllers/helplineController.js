const supabase = require('../supabase');

const PHONE_RE = /^[6-9]\d{9}$/;

// Get helplines for a building
exports.getHelplines = async (req, res) => {
  const building_id = req.user.building_id || req.query.building_id;
  if (!building_id) return res.status(400).json({ error: 'building_id is required' });

  const { data, error } = await supabase
    .from('helpline_numbers')
    .select('*')
    .eq('building_id', building_id)
    .order('profession', { ascending: true });

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};

// Pramukh / Admin: add helpline
exports.addHelpline = async (req, res) => {
  const { profession, name, phone } = req.body;
  const building_id = req.user.building_id || req.body.building_id;

  if (!building_id) return res.status(400).json({ error: 'building_id is required' });
  if (!profession?.trim() || !name?.trim() || !phone?.trim())
    return res.status(422).json({ error: 'profession, name and phone are required' });
  if (profession.trim().length > 100) return res.status(422).json({ error: 'Profession must not exceed 100 characters' });
  if (name.trim().length > 100) return res.status(422).json({ error: 'Name must not exceed 100 characters' });
  if (!PHONE_RE.test(phone.trim()))
    return res.status(422).json({ error: 'Phone must be a valid 10-digit Indian mobile number' });

  const { data, error } = await supabase
    .from('helpline_numbers')
    .insert({ building_id, profession: profession.trim(), name: name.trim(), phone: phone.trim(), created_by: req.user.id })
    .select().single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ message: 'Helpline added', helpline: data });
};

// Pramukh / Admin: delete helpline
exports.deleteHelpline = async (req, res) => {
  const { id } = req.params;
  const building_id = req.user.building_id;

  let query = supabase.from('helpline_numbers').delete().eq('id', id);
  // Pramukh can only delete from their building; admin can delete any
  if (req.user.role !== 'admin') query = query.eq('building_id', building_id);

  const { error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Deleted' });
};
