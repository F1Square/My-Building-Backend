const supabase = require('../supabase');

// GET /society-rules — user/pramukh: own building; admin: ?building_id=
exports.getRules = async (req, res) => {
  const building_id = req.user.building_id || req.query.building_id;
  if (!building_id) return res.status(400).json({ error: 'building_id is required' });

  const { data, error } = await supabase
    .from('society_rules')
    .select('*, creator:created_by(name), updater:updated_by(name)')
    .eq('building_id', building_id)
    .order('order_index', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
};

// POST /society-rules — pramukh/admin
exports.createRule = async (req, res) => {
  const { title, description, category, order_index } = req.body;
  const building_id = req.user.building_id || req.body.building_id;
  if (!building_id) return res.status(400).json({ error: 'building_id is required' });
  if (!title?.trim()) return res.status(422).json({ error: 'title is required' });

  const { data, error } = await supabase
    .from('society_rules')
    .insert({
      building_id, title: title.trim(),
      description: description?.trim() || null,
      category: category?.trim() || 'General',
      order_index: order_index ?? 0,
      created_by: req.user.id,
      updated_by: req.user.id,
    })
    .select().single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
};

// PATCH /society-rules/:id — pramukh/admin
exports.updateRule = async (req, res) => {
  const { id } = req.params;
  const { title, description, category, order_index } = req.body;

  const { data: existing } = await supabase.from('society_rules').select('building_id').eq('id', id).single();
  if (!existing) return res.status(404).json({ error: 'Rule not found' });

  if (req.user.role === 'pramukh' && existing.building_id !== req.user.building_id)
    return res.status(403).json({ error: 'Access denied' });

  const updates = { updated_by: req.user.id, updated_at: new Date().toISOString() };
  if (title !== undefined) updates.title = title.trim();
  if (description !== undefined) updates.description = description?.trim() || null;
  if (category !== undefined) updates.category = category?.trim() || 'General';
  if (order_index !== undefined) updates.order_index = order_index;

  const { data, error } = await supabase
    .from('society_rules').update(updates).eq('id', id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};

// DELETE /society-rules/:id — admin only
exports.deleteRule = async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('society_rules').delete().eq('id', id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Rule deleted' });
};
