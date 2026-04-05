const supabase = require('../supabase');
const crypto = require('crypto');

// Generate a random uppercase code like "SAVE20" or "FLAT150"
function generateCode(prefix = '') {
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return prefix ? `${prefix}-${rand}` : rand;
}

// Admin: create promo code
exports.createPromo = async (req, res) => {
  const { type, value, description, expires_at, prefix } = req.body;

  if (!['percent', 'flat'].includes(type))
    return res.status(422).json({ error: 'type must be percent or flat' });

  const parsed = parseFloat(value);
  if (isNaN(parsed) || parsed <= 0)
    return res.status(422).json({ error: 'value must be a positive number' });
  if (type === 'percent' && parsed > 100)
    return res.status(422).json({ error: 'Percentage cannot exceed 100' });

  const code = generateCode(prefix?.trim().toUpperCase() || '');

  const { data, error } = await supabase
    .from('promo_codes')
    .insert({
      code,
      type,
      value: parsed,
      description: description?.trim() || null,
      expires_at: expires_at || null,
      is_used: false,
      created_by: req.user.id,
    })
    .select().single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ message: 'Promo code created', promo: data });
};

// Admin: list all promo codes
exports.listPromos = async (req, res) => {
  const { data, error } = await supabase
    .from('promo_codes')
    .select('*, used_by_user:users!used_by(name, email)')
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};

// Admin: delete a promo code (only if unused)
exports.deletePromo = async (req, res) => {
  const { id } = req.params;
  const { data: promo } = await supabase.from('promo_codes').select('is_used').eq('id', id).single();
  if (!promo) return res.status(404).json({ error: 'Promo code not found' });
  if (promo.is_used) return res.status(400).json({ error: 'Cannot delete a used promo code' });

  const { error } = await supabase.from('promo_codes').delete().eq('id', id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Deleted' });
};

// User/Pramukh: validate a promo code (returns discount info, does NOT mark as used)
exports.validatePromo = async (req, res) => {
  const { code, plan } = req.body;
  if (!code?.trim()) return res.status(422).json({ error: 'code is required' });

  const { data: promo, error } = await supabase
    .from('promo_codes')
    .select('*')
    .eq('code', code.trim().toUpperCase())
    .single();

  if (error || !promo) return res.status(404).json({ error: 'Invalid promo code' });
  if (promo.is_used) return res.status(400).json({ error: 'This promo code has expired' });
  if (promo.expires_at && new Date(promo.expires_at) < new Date())
    return res.status(400).json({ error: 'This promo code has expired' });

  // Calculate discounted amount for the plan
  const PLAN_PRICES = { monthly: 15, yearly: 180, lifetime: 1500 };
  const original = PLAN_PRICES[plan] || 0;
  let discount = 0;
  if (promo.type === 'percent') {
    discount = Math.round((original * promo.value) / 100);
  } else {
    discount = Math.min(promo.value, original);
  }
  const final = Math.max(1, original - discount);

  res.json({
    valid: true,
    promo_id: promo.id,
    code: promo.code,
    type: promo.type,
    value: promo.value,
    description: promo.description,
    original_amount: original,
    discount_amount: discount,
    final_amount: final,
  });
};

// Called internally after successful payment to mark promo as used
exports.markPromoUsed = async (promo_id, user_id) => {
  await supabase.from('promo_codes').update({
    is_used: true,
    used_by: user_id,
    used_at: new Date().toISOString(),
  }).eq('id', promo_id);
};
