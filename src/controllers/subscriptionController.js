const supabase = require('../supabase');
const crypto = require('crypto');

const PLANS = {
  monthly:  { amount: 1500,   label: '₹15/month',    months: 1  },   // paise
  yearly:   { amount: 18000,  label: '₹180/year',    months: 12 },
  lifetime: { amount: 150000, label: '₹1500 lifetime', months: null },
};

// Get current user's subscription
exports.getMySubscription = async (req, res) => {
  const { data } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', req.user.id)
    .single();
  res.json(data || null);
};

// Create PhonePe order for subscription
exports.createOrder = async (req, res) => {
  const { plan, promo_id, include_newspaper } = req.body;
  if (!PLANS[plan]) return res.status(422).json({ error: 'Invalid plan. Choose monthly, yearly or lifetime' });

  const planInfo = PLANS[plan];
  let amount = planInfo.amount; // paise
  // Newspaper add-on pricing based on plan type
  if (include_newspaper) {
    if (plan === 'lifetime') return res.status(400).json({ error: 'Newspaper add-on is not available for lifetime plan' });
    else if (plan === 'yearly') amount += 3600; // ₹36
    else amount += 300; // ₹3
  }
  let appliedPromo = null;

  // Apply promo discount if provided
  if (promo_id) {
    const { data: promo } = await supabase
      .from('promo_codes').select('*').eq('id', promo_id).single();
    if (promo && !promo.is_used && (!promo.expires_at || new Date(promo.expires_at) > new Date())) {
      if (promo.type === 'percent') {
        amount = Math.max(100, Math.round(amount * (1 - promo.value / 100)));
      } else {
        // promo.value is in rupees, amount is in paise
        amount = Math.max(100, amount - Math.round(promo.value * 100));
      }
      appliedPromo = promo;
    } else if (promo?.is_used) {
      return res.status(400).json({ error: 'This promo code has expired' });
    }
  }

  try {
    const { generatePaymentRequest } = require('../utils/phonepeHelper');
    const merchantTransactionId = `SUB_${req.user.id.replace(/-/g, '')}_${Date.now()}`.substring(0, 34);
    const backendUrl = process.env.BACKEND_URL;
    if (!backendUrl) return res.status(500).json({ error: 'BACKEND_URL not set in .env' });

    // Pass necessary metadata as query params for the callback
    const redirectUrl = `${backendUrl}/api/subscriptions/phonepe-callback?type=subscription&plan=${plan}&user_id=${req.user.id}&promo_id=${promo_id || ''}&include_newspaper=${include_newspaper ? '1' : '0'}&txn_id=${merchantTransactionId}`;

    // Convert paise to rupees for PhonePe helper (which expects rupees and converts back to paise)
    const amountRupees = amount / 100;

    const phonepeResponse = await generatePaymentRequest({
      merchantTransactionId,
      amount: amountRupees,
      userId: req.user.id,
      mobileNumber: req.user.phone || "9999999999",
      redirectUrl
    });

    if (phonepeResponse.success) {
      res.json({
        order_id: merchantTransactionId,
        amount,
        checkout_url: phonepeResponse.data.instrumentResponse.redirectInfo.url,
        plan,
        promo_applied: !!appliedPromo
      });
    } else {
      res.status(500).json({ error: 'PhonePe API error: ' + phonepeResponse.message });
    }
  } catch (err) {
    console.error('PhonePe order error:', err);
    res.status(500).json({ error: 'Failed to create order: ' + err.message });
  }
};



// Admin: grant free subscription manually
exports.adminGrant = async (req, res) => {
  const { user_id, plan, months, remark } = req.body;
  if (!user_id || !PLANS[plan]) return res.status(422).json({ error: 'user_id and valid plan required' });
  if (months !== undefined && (isNaN(Number(months)) || Number(months) < 1 || Number(months) > 120))
    return res.status(422).json({ error: 'months must be between 1 and 120' });

  const now = new Date();
  const expires_at = plan === 'lifetime' ? null
    : new Date(now.getFullYear(), now.getMonth() + (months || 1), now.getDate()).toISOString();

  const { data: existing } = await supabase
    .from('subscriptions').select('id').eq('user_id', user_id).single();

  const payload = {
    user_id, plan, status: 'active',
    started_at: now.toISOString(), expires_at,
    razorpay_payment_id: 'admin_grant',
    remark: remark?.trim() || null,
  };

  let error;
  if (existing) {
    ({ error } = await supabase.from('subscriptions').update(payload).eq('user_id', user_id));
  } else {
    ({ error } = await supabase.from('subscriptions').insert(payload));
  }

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Subscription granted' });
};

// Admin: revoke subscription
exports.adminRevoke = async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(422).json({ error: 'user_id is required' });
  const { error } = await supabase
    .from('subscriptions').update({ status: 'cancelled', newspaper_addon: false }).eq('user_id', user_id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Subscription and newspaper addon revoked' });
};

// Admin: get all subscriptions with user details
exports.adminGetAll = async (req, res) => {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*, remark, paid_amount, promo_code_used, users(name, email, role, building_id, buildings(name))')
    .order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};

// Middleware: check active subscription (skip admin)
exports.requireSubscription = async (req, res, next) => {
  if (req.user.role === 'admin') return next();

  const { data } = await supabase
    .from('subscriptions')
    .select('plan, status, expires_at')
    .eq('user_id', req.user.id)
    .eq('status', 'active')
    .single();

  if (!data) return res.status(402).json({ error: 'subscription_required', message: 'Active subscription required' });

  // Check expiry for monthly
  if (data.plan === 'monthly' && data.expires_at && new Date(data.expires_at) < new Date()) {
    await supabase.from('subscriptions').update({ status: 'expired' }).eq('user_id', req.user.id);
    return res.status(402).json({ error: 'subscription_expired', message: 'Your subscription has expired' });
  }

  next();
};

// Callback from PhonePe for Subscription or Newspaper Add-on
exports.phonepeCallback = async (req, res) => {
  const { type, plan, user_id, promo_id, include_newspaper, txn_id } = req.query;

  try {
    const { checkPaymentStatus } = require('../utils/phonepeHelper');
    const statusData = await checkPaymentStatus(txn_id);

    if (statusData && statusData.code === 'PAYMENT_SUCCESS') {
      const phonepe_payment_id = statusData.data.transactionId;

      if (type === 'newspaper_addon') {
        // Just enabling newspaper addon
        const { error } = await supabase
          .from('subscriptions')
          .update({ newspaper_addon: true })
          .eq('user_id', user_id);
        
        return res.redirect(`mybuilding://subscription?status=success`);
      } else {
        // Subscription activation
        const now = new Date();
        const expires_at = plan === 'lifetime' ? null
          : new Date(now.getFullYear(), now.getMonth() + (PLANS[plan]?.months || 1), now.getDate()).toISOString();

        const { data: existing } = await supabase
          .from('subscriptions').select('id').eq('user_id', user_id).single();

        const payload = { 
          user_id, 
          plan, 
          status: 'active', 
          started_at: now.toISOString(), 
          expires_at, 
          razorpay_payment_id: phonepe_payment_id, 
          razorpay_order_id: txn_id 
        };

        if (existing) {
          await supabase.from('subscriptions').update(payload).eq('user_id', user_id);
        } else {
          await supabase.from('subscriptions').insert(payload);
        }

        // Activate newspaper add-on if included
        if (include_newspaper === '1') {
          await supabase.from('subscriptions').update({ newspaper_addon: true }).eq('user_id', user_id);
        }

        // Mark promo as used
        if (promo_id) {
          const { markPromoUsed } = require('./promoController');
          await markPromoUsed(promo_id, user_id);
          const { data: promo } = await supabase.from('promo_codes').select('code').eq('id', promo_id).single();
          const paidAmountRupees = Math.round(Number(statusData.data.amount) / 100);
          await supabase.from('subscriptions').update({
            paid_amount: paidAmountRupees,
            promo_code_used: promo?.code || null,
          }).eq('user_id', user_id);
        } else {
          const PLAN_PRICES = { monthly: 15, yearly: 180, lifetime: 1500 };
          await supabase.from('subscriptions').update({
            paid_amount: PLAN_PRICES[plan] || null,
            promo_code_used: null,
          }).eq('user_id', user_id);
        }

        return res.redirect(`mybuilding://subscription?status=success`);
      }
    } else {
      return res.redirect(`mybuilding://subscription?status=failed`);
    }
  } catch (err) {
    console.error("PhonePe callback error:", err);
    return res.redirect(`mybuilding://subscription?status=failed`);
  }
};

// ── Newspaper Add-On ─────────────────────────────────────────────────────────

const NEWSPAPER_ADDON_AMOUNT = 300; // ₹3 in paise

// Create PhonePe order for newspaper add-on
exports.createNewspaperAddonOrder = async (req, res) => {
  // Must have an active subscription
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('id, plan, status, expires_at, newspaper_addon')
    .eq('user_id', req.user.id)
    .single();

  if (!sub || sub.status !== 'active') {
    return res.status(400).json({ error: 'Active subscription required to add newspaper add-on' });
  }
  if (sub.newspaper_addon) {
    return res.status(400).json({ error: 'Newspaper add-on is already active' });
  }

  const { plan: requestedPlan } = req.body;
  const addonPlan = requestedPlan || sub.plan;
  
  const ADDON_PRICES = {
    monthly: 300,   // ₹3
    yearly: 3600,   // ₹36
  };

  if (!ADDON_PRICES[addonPlan]) {
    return res.status(422).json({ error: 'Invalid newspaper plan. Choose monthly or yearly' });
  }

  const addonAmount = ADDON_PRICES[addonPlan];

  try {
    const { generatePaymentRequest } = require('../utils/phonepeHelper');
    const merchantTransactionId = `NEWS_${req.user.id.replace(/-/g, '')}_${Date.now()}`.substring(0, 34);
    const backendUrl = process.env.BACKEND_URL;
    if (!backendUrl) return res.status(500).json({ error: 'BACKEND_URL not set in .env' });
    
    // Pass the selected plan to callback so we know what duration to set (though currently it's just a boolean)
    // In future, we could store newspaper_expires_at separately.
    const redirectUrl = `${backendUrl}/api/subscriptions/phonepe-callback?type=newspaper_addon&user_id=${req.user.id}&txn_id=${merchantTransactionId}`;
    const amountRupees = addonAmount / 100;

    const phonepeResponse = await generatePaymentRequest({
      merchantTransactionId,
      amount: amountRupees,
      userId: req.user.id,
      mobileNumber: req.user.phone || "9999999999",
      redirectUrl
    });

    if (phonepeResponse.success) {
      res.json({
        order_id: merchantTransactionId,
        amount: addonAmount,
        checkout_url: phonepeResponse.data.instrumentResponse.redirectInfo.url
      });
    } else {
      res.status(500).json({ error: 'PhonePe API error: ' + phonepeResponse.message });
    }
  } catch (err) {
    console.error('Newspaper add-on order error:', err.response?.data || err.message || err);
    res.status(500).json({ error: 'Failed to create order: ' + (err.response?.data?.message || err.message) });
  }
};

// Toggle newspaper add-on off (no refund — just disable)
exports.toggleNewspaperAddon = async (req, res) => {
  const { enable } = req.body;

  if (enable) {
    // Enabling requires payment — use createNewspaperAddonOrder instead
    return res.status(400).json({ error: 'Use /newspaper-addon/order to enable the add-on via payment' });
  }

  // Disable
  const { error } = await supabase
    .from('subscriptions')
    .update({ newspaper_addon: false })
    .eq('user_id', req.user.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Newspaper add-on disabled' });
};

// ── Validate promo code (web-friendly endpoint) ──────────────────────────────
exports.validatePromoCode = async (req, res) => {
  const { code } = req.body;
  if (!code?.trim()) return res.status(422).json({ error: 'Promo code is required' });

  const { data: promo, error } = await supabase
    .from('promo_codes')
    .select('*')
    .ilike('code', code.trim())
    .single();

  if (error || !promo) return res.status(404).json({ error: 'Invalid promo code' });
  if (promo.is_used) return res.status(400).json({ error: 'This promo code has already been used' });
  if (promo.expires_at && new Date(promo.expires_at) < new Date())
    return res.status(400).json({ error: 'This promo code has expired' });

  const discount_percent = promo.type === 'percent' ? promo.value : null;
  const discount = promo.type !== 'percent' ? promo.value : null;

  res.json({ id: promo.id, code: promo.code, discount_percent, discount });
};

// ── Upgrade plan ─────────────────────────────────────────────────────────────
exports.upgradePlan = async (req, res) => {
  const { plan_id } = req.body;
  if (!plan_id) return res.status(422).json({ error: 'plan_id is required' });

  // Get current subscription
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', req.user.id)
    .single();

  if (!sub || sub.status !== 'active')
    return res.status(400).json({ error: 'Active subscription required to upgrade' });

  // Get target plan
  const { data: plan } = await supabase
    .from('subscription_plans')
    .select('*')
    .eq('id', plan_id)
    .single();

  if (!plan) return res.status(404).json({ error: 'Plan not found' });

  const now = new Date();
  const expires_at = plan.duration_days
    ? new Date(now.getTime() + plan.duration_days * 24 * 60 * 60 * 1000).toISOString()
    : null;

  const { error } = await supabase
    .from('subscriptions')
    .update({ plan: plan.name, status: 'active', started_at: now.toISOString(), expires_at })
    .eq('user_id', req.user.id);

  if (error) return res.status(400).json({ error: error.message });

  const { data: updated } = await supabase
    .from('subscriptions').select('*').eq('user_id', req.user.id).single();

  res.json({ message: 'Plan upgraded', subscription: updated });
};
