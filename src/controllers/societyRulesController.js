const supabase = require('../supabase');
const ns = require('../utils/notificationService');
const { createCopy } = require('../utils/notificationCopy');
const {
  userDisplayName,
  withDisplayUser,
  mapRowsWithDisplayUsers,
} = require('../utils/userDisplayName');

const VALID_CATEGORIES = [
  'General', 'Parking', 'Noise', 'Cleanliness', 'Security', 'Pets', 'Guests', 'Other',
];

/** List/detail payload — no emails; updater name only (UI never uses creator). */
const RULE_SELECT =
  'id, building_id, title, description, category, order_index, created_at, updated_at, updater:updated_by(name)';

function resolveBuildingId(req, fromBody = false) {
  if (req.user.role === 'admin') {
    return (fromBody ? req.body.building_id : null) || req.query.building_id || req.user.building_id;
  }
  return req.user.building_id;
}

function normalizeCategory(category) {
  const c = (category || 'General').trim();
  return VALID_CATEGORIES.includes(c) ? c : 'General';
}

async function nextOrderIndex(building_id) {
  const { data: last } = await supabase
    .from('society_rules')
    .select('order_index')
    .eq('building_id', building_id)
    .order('order_index', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (last?.order_index ?? -1) + 1;
}

function mapRule(row) {
  if (!row) return row;
  return { ...row, updater: withDisplayUser(row.updater) };
}

async function notifyRulePublished(building_id, rule, byName, isUpdate) {
  await ns.notifyMembers(building_id, {
    type: isUpdate ? 'society_rule_updated' : 'society_rule',
    meta: { rule_id: rule.id, category: rule.category },
    build: (lang) => createCopy(lang).societyRule(rule.title, rule.category, byName, isUpdate),
  });
}

// GET /society-rules — user/pramukh: own building; admin: ?building_id=
exports.getRules = async (req, res) => {
  const building_id = resolveBuildingId(req, false);
  if (!building_id) return res.status(400).json({ error: 'building_id is required' });

  const { data, error } = await supabase
    .from('society_rules')
    .select(RULE_SELECT)
    .eq('building_id', building_id)
    .order('order_index', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) return res.status(400).json({ error: error.message });
  res.json(mapRowsWithDisplayUsers(data || [], ['updater']));
};

// POST /society-rules — pramukh/admin
exports.createRule = async (req, res) => {
  const { title, description, category } = req.body;
  const building_id = resolveBuildingId(req, true);
  if (!building_id) return res.status(400).json({ error: 'building_id is required' });
  if (!title?.trim()) return res.status(422).json({ error: 'title is required' });
  if (title.trim().length > 150) return res.status(422).json({ error: 'Title must not exceed 150 characters' });
  if (description && description.trim().length > 2000) {
    return res.status(422).json({ error: 'Description must not exceed 2000 characters' });
  }

  const order_index = await nextOrderIndex(building_id);
  const resolvedCategory = normalizeCategory(category);

  const { data, error } = await supabase
    .from('society_rules')
    .insert({
      building_id,
      title: title.trim(),
      description: description?.trim() || null,
      category: resolvedCategory,
      order_index,
      created_by: req.user.id,
      updated_by: req.user.id,
    })
    .select(RULE_SELECT)
    .single();

  if (error) return res.status(400).json({ error: error.message });

  const mapped = mapRule(data);
  await notifyRulePublished(building_id, mapped, userDisplayName(req.user, 'Pramukh'), false);
  res.status(201).json(mapped);
};

// PATCH /society-rules/:id — pramukh/admin
exports.updateRule = async (req, res) => {
  const { id } = req.params;
  const { title, description, category } = req.body;

  const { data: existing } = await supabase
    .from('society_rules')
    .select('building_id, title')
    .eq('id', id)
    .single();
  if (!existing) return res.status(404).json({ error: 'Rule not found' });

  if (req.user.role === 'pramukh' && existing.building_id !== req.user.building_id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const updates = { updated_by: req.user.id, updated_at: new Date().toISOString() };
  if (title !== undefined) {
    if (!title?.trim()) return res.status(422).json({ error: 'title is required' });
    if (title.trim().length > 150) return res.status(422).json({ error: 'Title must not exceed 150 characters' });
    updates.title = title.trim();
  }
  if (description !== undefined) {
    if (description && description.trim().length > 2000) {
      return res.status(422).json({ error: 'Description must not exceed 2000 characters' });
    }
    updates.description = description?.trim() || null;
  }
  if (category !== undefined) updates.category = normalizeCategory(category);
  // order_index is auto-managed on create; ignore client order to avoid accidental reshuffles

  const { data, error } = await supabase
    .from('society_rules')
    .update(updates)
    .eq('id', id)
    .select(RULE_SELECT)
    .single();
  if (error) return res.status(400).json({ error: error.message });

  const mapped = mapRule(data);
  await notifyRulePublished(
    existing.building_id,
    mapped,
    userDisplayName(req.user, 'Pramukh'),
    true,
  );
  res.json(mapped);
};

// DELETE /society-rules/:id — pramukh (own building) or admin
exports.deleteRule = async (req, res) => {
  const { id } = req.params;

  const { data: existing } = await supabase
    .from('society_rules')
    .select('building_id')
    .eq('id', id)
    .single();
  if (!existing) return res.status(404).json({ error: 'Rule not found' });

  if (req.user.role === 'pramukh' && existing.building_id !== req.user.building_id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const { error } = await supabase.from('society_rules').delete().eq('id', id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Rule deleted' });
};
