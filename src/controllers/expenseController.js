const supabase = require('../supabase');

// ── Get all wings for a building ──────────────────────────────────────────────
exports.getWings = async (req, res) => {
  const building_id = req.user.building_id || req.query.building_id;
  if (!building_id) return res.status(400).json({ error: 'building_id required' });

  try {
    const { data: building } = await supabase
      .from('buildings').select('wings').eq('id', building_id).single();

    if (!building?.wings) {
      // Return a single "Building-Wide" wing if no wings are configured
      return res.json([{ wing: 'Building-Wide' }]);
    }

    // Parse comma-separated wings (e.g. "A, B, C" -> [{ wing: 'A' }, { wing: 'B' }, { wing: 'C' }])
    const wingList = building.wings
      .split(',')
      .map(w => ({ wing: w.trim() }))
      .filter(w => w.wing);

    res.json(wingList.length > 0 ? wingList : [{ wing: 'Building-Wide' }]);
  } catch (error) {
    console.error('[getWings] Error:', error);
    res.json([{ wing: 'Building-Wide' }]);
  }
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const VALID_TYPES = ['inflow', 'outflow'];

// Fast incremental balance update — no full scan
async function adjustBalance(building_id, wing = 'Building-Wide', delta) {
  // delta = positive for inflow, negative for outflow
  const { data: fund } = await supabase
    .from('society_funds').select('current_balance').eq('building_id', building_id).eq('wing', wing).single();

  const current = parseFloat(fund?.current_balance || 0);
  const newBalance = current + delta;

  await supabase.from('society_funds')
    .upsert({ building_id, wing, current_balance: newBalance, updated_at: new Date().toISOString() }, { onConflict: 'building_id,wing' });

  return newBalance;
}

// ── Get fund summary (balance + opening) ─────────────────────────────────────
exports.getFundSummary = async (req, res) => {
  const building_id = req.user.building_id || req.query.building_id;
  const wing = req.query.wing || 'Building-Wide';
  if (!building_id) return res.status(400).json({ error: 'building_id required' });

  const { data } = await supabase
    .from('society_funds')
    .select('*')
    .eq('building_id', building_id)
    .eq('wing', wing)
    .single();

  res.json(data || { building_id, wing, opening_balance: null, current_balance: 0 });
};

// ── Set opening balance (pramukh first-time setup or admin) ──────────────────
exports.setOpeningBalance = async (req, res) => {
  const { amount, building_id: bodyBuildingId, wing = 'Building-Wide' } = req.body;
  const building_id = req.user.building_id || bodyBuildingId;
  if (!building_id) return res.status(400).json({ error: 'building_id required' });

  const parsed = parseFloat(amount);
  if (isNaN(parsed) || parsed < 0) return res.status(422).json({ error: 'Amount must be a valid non-negative number' });

  const { data: existing } = await supabase
    .from('society_funds').select('id').eq('building_id', building_id).eq('wing', wing).single();

  const payload = {
    building_id,
    wing,
    opening_balance: parsed,
    current_balance: parsed,
    updated_at: new Date().toISOString(),
    set_by: req.user.id,
  };

  let error;
  if (existing) {
    ({ error } = await supabase.from('society_funds').update(payload).eq('building_id', building_id).eq('wing', wing));
  } else {
    ({ error } = await supabase.from('society_funds').insert(payload));
  }

  if (error) return res.status(400).json({ error: error.message });

  const { data: existingEntries } = await supabase
    .from('expense_entries').select('type, amount').eq('building_id', building_id).eq('wing', wing);
  let balance = parsed;
  (existingEntries || []).forEach((e) => {
    balance += e.type === 'inflow' ? parseFloat(e.amount) : -parseFloat(e.amount);
  });
  await supabase.from('society_funds')
    .update({ current_balance: balance, updated_at: new Date().toISOString() })
    .eq('building_id', building_id)
    .eq('wing', wing);

  res.json({ message: 'Opening balance set', current_balance: balance });
};

// ── Get expense entries ───────────────────────────────────────────────────────
exports.getEntries = async (req, res) => {
  const building_id = req.user.building_id || req.query.building_id;
  const wing = req.query.wing || 'Building-Wide';
  if (!building_id) return res.status(400).json({ error: 'building_id required' });

  const { type, limit = 100 } = req.query;

  let query = supabase
    .from('expense_entries')
    .select('*, added_by_user:users!expense_entries_added_by_fkey(name, role), edited_by_user:users!expense_entries_edited_by_fkey(name)')
    .eq('building_id', building_id)
    .eq('wing', wing)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(Number(limit));

  if (type) query = query.eq('type', type);

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
};

// ── Add entry ─────────────────────────────────────────────────────────────────
exports.addEntry = async (req, res) => {
  const { type, amount, description, category, date, building_id: bodyBuildingId, wing = 'Building-Wide' } = req.body;
  const building_id = req.user.building_id || bodyBuildingId;
  if (!building_id) return res.status(400).json({ error: 'building_id required' });

  if (!VALID_TYPES.includes(type)) return res.status(422).json({ error: 'type must be inflow or outflow' });
  const parsed = parseFloat(amount);
  if (isNaN(parsed) || parsed <= 0) return res.status(422).json({ error: 'Amount must be a positive number' });
  if (!description?.trim()) return res.status(422).json({ error: 'Description is required' });
  if (description.trim().length > 300) return res.status(422).json({ error: 'Description must not exceed 300 characters' });

  const entryDate = date || new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('expense_entries')
    .insert({
      building_id, wing, type, amount: parsed,
      description: description.trim(),
      category: category?.trim() || null,
      date: entryDate,
      added_by: req.user.id,
      is_edited: false,
    })
    .select().single();

  if (error) return res.status(400).json({ error: error.message });

  const delta = type === 'inflow' ? parsed : -parsed;
  const balance = await adjustBalance(building_id, wing, delta);
  res.status(201).json({ message: 'Entry added', entry: data, current_balance: balance });
};

// ── Edit entry ────────────────────────────────────────────────────────────────
exports.editEntry = async (req, res) => {
  const { id } = req.params;
  const { type, amount, description, category, date, wing = 'Building-Wide' } = req.body;
  const building_id = req.user.building_id || req.body.building_id;

  // Fetch original
  const { data: original, error: fetchErr } = await supabase
    .from('expense_entries').select('*').eq('id', id).single();
  if (fetchErr || !original) return res.status(404).json({ error: 'Entry not found' });

  // Security: pramukh can only edit their own building
  if (req.user.role === 'pramukh' && original.building_id !== req.user.building_id)
    return res.status(403).json({ error: 'Access denied' });

  if (type && !VALID_TYPES.includes(type)) return res.status(422).json({ error: 'type must be inflow or outflow' });
  if (amount !== undefined) {
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) return res.status(422).json({ error: 'Amount must be a positive number' });
  }

  // Log the edit
  await supabase.from('expense_edit_logs').insert({
    entry_id: id,
    building_id: original.building_id,
    wing: original.wing,
    edited_by: req.user.id,
    old_type: original.type,
    old_amount: original.amount,
    old_description: original.description,
    old_category: original.category,
    old_date: original.date,
    edited_at: new Date().toISOString(),
  });

  const updates = {
    is_edited: true,
    edited_by: req.user.id,
    edited_at: new Date().toISOString(),
  };
  if (type) updates.type = type;
  if (amount !== undefined) updates.amount = parseFloat(amount);
  if (description !== undefined) updates.description = description.trim();
  if (category !== undefined) updates.category = category?.trim() || null;
  if (date !== undefined) updates.date = date;

  const { data, error } = await supabase
    .from('expense_entries').update(updates).eq('id', id).select().single();
  if (error) return res.status(400).json({ error: error.message });

  // Reverse old entry, apply new entry
  const oldDelta = original.type === 'inflow' ? -parseFloat(original.amount) : parseFloat(original.amount);
  const newType = updates.type || original.type;
  const newAmount = updates.amount !== undefined ? updates.amount : parseFloat(original.amount);
  const newDelta = newType === 'inflow' ? newAmount : -newAmount;
  const balance = await adjustBalance(original.building_id, original.wing, oldDelta + newDelta);
  res.json({ message: 'Entry updated', entry: data, current_balance: balance });
};

// ── Delete entry ──────────────────────────────────────────────────────────────
exports.deleteEntry = async (req, res) => {
  const { id } = req.params;

  const { data: entry } = await supabase
    .from('expense_entries').select('building_id, wing, type, amount').eq('id', id).single();
  if (!entry) return res.status(404).json({ error: 'Entry not found' });

  if (req.user.role === 'pramukh' && entry.building_id !== req.user.building_id)
    return res.status(403).json({ error: 'Access denied' });

  const { error } = await supabase.from('expense_entries').delete().eq('id', id);
  if (error) return res.status(400).json({ error: error.message });

  // Reverse the deleted entry's effect on balance
  const delta = entry.type === 'inflow' ? -parseFloat(entry.amount) : parseFloat(entry.amount);
  const balance = await adjustBalance(entry.building_id, entry.wing, delta);
  res.json({ message: 'Entry deleted', current_balance: balance });
};

// ── Get edit logs (admin only) ────────────────────────────────────────────────
exports.getEditLogs = async (req, res) => {
  const building_id = req.user.building_id || req.query.building_id;
  const wing = req.query.wing || 'Building-Wide';

  let query = supabase
    .from('expense_edit_logs')
    .select('*, edited_by_user:users!expense_edit_logs_edited_by_fkey(name, role)')
    .eq('wing', wing)
    .order('edited_at', { ascending: false })
    .limit(200);

  if (building_id) query = query.eq('building_id', building_id);

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
};
