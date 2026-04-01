const supabase = require('../supabase');

// Pramukh: set/update society fund
exports.setFund = async (req, res) => {
  const { amount, note } = req.body;
  const building_id = req.user.building_id;

  const parsed = parseFloat(amount);
  if (amount === undefined || amount === null || amount === '') return res.status(422).json({ error: 'Amount is required' });
  if (isNaN(parsed) || parsed < 0) return res.status(422).json({ error: 'Amount must be a valid non-negative number' });
  if (parsed > 99999999) return res.status(422).json({ error: 'Amount is too large' });
  if (note && note.length > 500) return res.status(422).json({ error: 'Note must not exceed 500 characters' });

  const { data: existing } = await supabase
    .from('society_funds').select('id').eq('building_id', building_id).single();

  const payload = { amount: parseFloat(amount), note: note?.trim(), updated_at: new Date().toISOString() };
  let result;

  if (existing) {
    result = await supabase.from('society_funds').update(payload).eq('building_id', building_id).select().single();
  } else {
    result = await supabase.from('society_funds').insert({ building_id, ...payload }).select().single();
  }

  if (result.error) return res.status(400).json({ error: result.error.message });
  res.json({ message: 'Fund updated', fund: result.data });
};

// Get society fund
exports.getFund = async (req, res) => {
  const building_id = req.user.building_id || req.query.building_id;
  if (!building_id) return res.status(400).json({ error: 'Building ID required' });

  const { data, error } = await supabase
    .from('society_funds').select('*').eq('building_id', building_id).single();

  if (error) return res.json({ fund: null, amount: 0 });
  res.json(data);
};
