const supabase = require('../supabase');
const crypto = require('crypto');
const { getPaymentCallbackUrl } = require('../utils/backendUrl');
const {
  getPlanForPayment,
  getPlanRupeeBase,
  listPublicPlans,
  parseFeePaise,
  checkoutExtraFeesPaise,
} = require('../utils/subscriptionPlans');

/** Admin/paid newspaper term → expiry ISO. */
function newspaperExpiresAtFromTerm(term, fromDate = new Date()) {
  const d = new Date(fromDate);
  if (term === 'yearly') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d.toISOString();
}

function newspaperTermFromPlan(planSlug, planCfg) {
  if (planSlug === 'yearly' || planCfg?.months === 12) return 'yearly';
  return 'monthly';
}

// Get current user's subscription
exports.getMySubscription = async (req, res) => {
  const { data } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', req.user.id)
    .single();
  if (!data) return res.json(null);
  res.json({
    ...data,
    gateway_payment_id: data.razorpay_payment_id || null,
    gateway_order_id: data.razorpay_order_id || null,
  });
};

// Public: active plans for subscribe UI
exports.publicListPlans = async (req, res) => {
  try {
    const plans = await listPublicPlans();
    res.json(plans);
  } catch (e) {
    console.error('publicListPlans', e);
    res.status(500).json({ error: 'Failed to load plans' });
  }
};

// Admin: all plans (including inactive)
exports.adminListPlans = async (req, res) => {
  const { data, error } = await supabase
    .from('subscription_plans')
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
};

exports.adminCreatePlan = async (req, res) => {
  const {
    slug, title, description, amount_paise, months,
    allow_newspaper_addon, newspaper_addon_paise,
    platform_fee_paise, other_fee_paise,
    sort_order, features, is_active,
  } = req.body;

  if (!slug?.trim() || !title?.trim() || amount_paise == null) {
    return res.status(422).json({ error: 'slug, title, and amount_paise are required' });
  }
  const cleanSlug = String(slug).trim().toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(cleanSlug)) {
    return res.status(422).json({ error: 'slug must be lowercase letters, numbers, hyphens or underscores' });
  }
  const paise = parseInt(amount_paise, 10);
  if (Number.isNaN(paise) || paise < 100) {
    return res.status(422).json({ error: 'amount_paise must be at least 100 (₹1)' });
  }
  let monthsVal = months === null || months === '' ? null : parseInt(months, 10);
  if (monthsVal !== null && (Number.isNaN(monthsVal) || monthsVal < 1 || monthsVal > 120)) {
    return res.status(422).json({ error: 'months must be 1–120 or null for lifetime' });
  }

  const row = {
    slug: cleanSlug,
    title: title.trim(),
    description: description?.trim() || null,
    amount_paise: paise,
    months: monthsVal,
    allow_newspaper_addon: allow_newspaper_addon !== false,
    newspaper_addon_paise: newspaper_addon_paise == null || newspaper_addon_paise === ''
      ? null
      : (() => {
          const n = parseInt(newspaper_addon_paise, 10);
          return Number.isNaN(n) ? null : n;
        })(),
    platform_fee_paise: parseFeePaise(platform_fee_paise),
    other_fee_paise: parseFeePaise(other_fee_paise),
    sort_order: sort_order == null ? 0 : parseInt(sort_order, 10) || 0,
    is_active: is_active !== false,
    features: Array.isArray(features) ? features : [],
  };

  const { data, error } = await supabase.from('subscription_plans').insert(row).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
};

exports.adminUpdatePlan = async (req, res) => {
  const { id } = req.params;
  const {
    slug, title, description, amount_paise, months,
    allow_newspaper_addon, newspaper_addon_paise,
    platform_fee_paise, other_fee_paise,
    sort_order, features, is_active,
  } = req.body;

  const patch = {};
  if (title != null) patch.title = String(title).trim();
  if (description !== undefined) patch.description = description?.trim() || null;
  if (amount_paise != null) {
    const paise = parseInt(amount_paise, 10);
    if (Number.isNaN(paise) || paise < 100) {
      return res.status(422).json({ error: 'amount_paise must be at least 100' });
    }
    patch.amount_paise = paise;
  }
  if (months !== undefined) {
    if (months === null || months === '') patch.months = null;
    else {
      const m = parseInt(months, 10);
      if (Number.isNaN(m) || m < 1 || m > 120) {
        return res.status(422).json({ error: 'months must be 1–120 or null' });
      }
      patch.months = m;
    }
  }
  if (slug != null) {
    const cleanSlug = String(slug).trim().toLowerCase();
    if (!/^[a-z0-9_-]+$/.test(cleanSlug)) {
      return res.status(422).json({ error: 'invalid slug' });
    }
    patch.slug = cleanSlug;
  }
  if (allow_newspaper_addon !== undefined) patch.allow_newspaper_addon = !!allow_newspaper_addon;
  if (newspaper_addon_paise !== undefined) {
    patch.newspaper_addon_paise = newspaper_addon_paise == null ? null : parseInt(newspaper_addon_paise, 10);
  }
  if (platform_fee_paise !== undefined) patch.platform_fee_paise = parseFeePaise(platform_fee_paise);
  if (other_fee_paise !== undefined) patch.other_fee_paise = parseFeePaise(other_fee_paise);
  if (sort_order != null) patch.sort_order = parseInt(sort_order, 10) || 0;
  if (is_active !== undefined) patch.is_active = !!is_active;
  if (features !== undefined) patch.features = Array.isArray(features) ? features : [];
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('subscription_plans')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Plan not found' });
  res.json(data);
};

/** Soft-delete: deactivate plan (existing subscriber slugs still work via fallback/history). */
exports.adminDeletePlan = async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase
    .from('subscription_plans')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Plan deactivated' });
};

// Create Easebuzz order for subscription
exports.createOrder = async (req, res) => {
  const { plan, promo_id, include_newspaper } = req.body;
  const planInfo = await getPlanForPayment(plan);
  if (!planInfo) return res.status(422).json({ error: 'Invalid or inactive plan' });

  let amount = planInfo.amount_paise; // paise
  // Newspaper add-on
  if (include_newspaper) {
    if (!planInfo.allow_newspaper_addon) {
      return res.status(400).json({ error: 'Newspaper add-on is not available for this plan' });
    }
    let addon = planInfo.newspaper_addon_paise;
    if (addon == null || Number.isNaN(addon)) {
      addon = planInfo.months === 12 ? 3600 : 300;
    }
    amount += addon;
  }
  let appliedPromo = null;

  // Apply promo discount if provided (on plan + newspaper; fees added after)
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

  // Platform + other fees (always charged at checkout when configured on the plan)
  amount += checkoutExtraFeesPaise(planInfo);

  try {
    const { initiatePayment } = require('../utils/easebuzzHelper');
    // Easebuzz requires txnid to be alphanumeric only, max 25 chars.
    const merchantTransactionId = `S${req.user.id.replace(/-/g, '').substring(0, 10)}${Date.now()}`.substring(0, 25);
    // Always derive backend URL from the actual request — works in dev (local IP)
    // AND in prod (Vercel) since `trust proxy` is enabled in index.js.
    const backendUrl = getPaymentCallbackUrl(req);
    if (!backendUrl) return res.status(500).json({ error: 'Cannot resolve backend URL from request' });

    const redirectUrl = `${backendUrl}/api/subscriptions/easebuzz-callback?type=subscription&plan=${plan}&user_id=${req.user.id}&promo_id=${promo_id || ''}&include_newspaper=${include_newspaper ? '1' : '0'}&txn_id=${merchantTransactionId}`;
    const { paymentUrl } = await initiatePayment({
      txnid: merchantTransactionId,
      amount: amount / 100,
      productinfo: `Subscription ${plan}`,
      firstname: req.user.name || 'User',
      email: req.user.email || 'customer@example.com',
      phone: req.user.phone || '9999999999',
      surl: redirectUrl,
      furl: redirectUrl,
      udf1: req.user.id,
      udf2: plan,
      udf3: include_newspaper ? 'newspaper_yes' : 'newspaper_no',
      udf4: 'subscription',
      // Settlement intent marker: subscriptions must credit admin account.
      udf5: 'adminsubscription',
    });

    res.json({
      order_id: merchantTransactionId,
      amount,
      checkout_url: paymentUrl,
      plan,
      promo_applied: !!appliedPromo,
      settlement_target: 'admin',
    });
  } catch (err) {
    console.error('Easebuzz order error:', err);
    res.status(500).json({ error: 'Failed to create order: ' + err.message });
  }
};



// Admin: grant free subscription manually
exports.adminGrant = async (req, res) => {
  const { user_id, plan, months, remark, include_newspaper, newspaper_term } = req.body;
  const planCfg = await getPlanForPayment(plan);
  if (!user_id || !planCfg) return res.status(422).json({ error: 'user_id and valid active plan slug required' });
  if (months !== undefined && (isNaN(Number(months)) || Number(months) < 1 || Number(months) > 120))
    return res.status(422).json({ error: 'months must be between 1 and 120' });

  const wantsNewspaper = !!include_newspaper;
  const isLifetime = planCfg.months == null;
  // Lifetime has no paid newspaper SKU; admin may still grant monthly/yearly newspaper access.
  if (wantsNewspaper && !planCfg.allow_newspaper_addon && !isLifetime) {
    return res.status(400).json({ error: 'Newspaper add-on is not available for this plan' });
  }
  let newsTerm = null;
  if (wantsNewspaper && isLifetime) {
    newsTerm = newspaper_term === 'yearly' ? 'yearly' : newspaper_term === 'monthly' ? 'monthly' : null;
    if (!newsTerm) {
      return res.status(422).json({ error: 'Select monthly or yearly newspaper add-on for lifetime grants' });
    }
  }

  const now = new Date();
  const termMonths = planCfg.months == null ? null : (months != null ? Number(months) : planCfg.months);
  const expires_at = termMonths == null ? null
    : new Date(now.getFullYear(), now.getMonth() + termMonths, now.getDate()).toISOString();

  const { data: existing } = await supabase
    .from('subscriptions').select('id, newspaper_addon, newspaper_expires_at').eq('user_id', user_id).single();

  let grantRemark = remark?.trim() || null;
  if (wantsNewspaper && newsTerm) {
    const newsNote = `Newspaper add-on (${newsTerm})`;
    grantRemark = grantRemark ? `${grantRemark} | ${newsNote}` : newsNote;
  }

  let newspaper_expires_at = existing?.newspaper_expires_at ?? null;
  if (wantsNewspaper) {
    newspaper_expires_at = newsTerm
      ? newspaperExpiresAtFromTerm(newsTerm)
      : (expires_at || newspaperExpiresAtFromTerm('monthly'));
  }

  const payload = {
    user_id, plan: planCfg.slug, status: 'active',
    started_at: now.toISOString(), expires_at,
    razorpay_payment_id: 'admin_grant',
    remark: grantRemark,
    newspaper_addon: wantsNewspaper ? true : (existing?.newspaper_addon ?? false),
    newspaper_expires_at: wantsNewspaper ? newspaper_expires_at : (existing?.newspaper_expires_at ?? null),
  };

  let error;
  if (existing) {
    ({ error } = await supabase.from('subscriptions').update(payload).eq('user_id', user_id));
  } else {
    ({ error } = await supabase.from('subscriptions').insert(payload));
  }

  if (error) return res.status(400).json({ error: error.message });
  res.json({
    message: wantsNewspaper ? 'Subscription granted with newspaper add-on' : 'Subscription granted',
    newspaper_addon: payload.newspaper_addon,
    newspaper_term: newsTerm,
  });
};

// Admin: grant newspaper add-on only (user must already have active subscription)
exports.adminGrantNewspaper = async (req, res) => {
  const { user_id, remark, newspaper_term } = req.body;
  if (!user_id) return res.status(422).json({ error: 'user_id is required' });
  if (!remark?.trim()) return res.status(422).json({ error: 'remark is required' });

  const { data: sub, error: fetchErr } = await supabase
    .from('subscriptions')
    .select('id, status, expires_at, plan, newspaper_addon, remark')
    .eq('user_id', user_id)
    .maybeSingle();

  if (fetchErr) return res.status(400).json({ error: fetchErr.message });
  if (!sub || sub.status !== 'active') {
    return res.status(400).json({ error: 'User must have an active subscription before granting newspaper access' });
  }
  if (sub.expires_at && new Date(sub.expires_at) < new Date()) {
    return res.status(400).json({ error: 'User subscription has expired' });
  }
  if (sub.newspaper_addon) {
    return res.status(400).json({ error: 'Newspaper add-on is already active for this user' });
  }

  const planCfg = await getPlanForPayment(sub.plan);
  const isLifetime = planCfg ? planCfg.months == null : sub.plan === 'lifetime';
  if (planCfg && !planCfg.allow_newspaper_addon && !isLifetime) {
    return res.status(400).json({ error: 'Newspaper add-on is not available for this user\'s plan' });
  }

  let newsTerm = newspaper_term === 'yearly' ? 'yearly' : newspaper_term === 'monthly' ? 'monthly' : null;
  if (isLifetime && !newsTerm) {
    return res.status(422).json({ error: 'Select monthly or yearly newspaper add-on for lifetime users' });
  }
  if (!newsTerm && planCfg) {
    newsTerm = planCfg.months === 12 ? 'yearly' : 'monthly';
  }

  const note = newsTerm
    ? `Newspaper grant (${newsTerm}): ${remark.trim()}`
    : `Newspaper grant: ${remark.trim()}`;
  const mergedRemark = sub.remark ? `${sub.remark} | ${note}` : note;
  const newspaper_expires_at = newsTerm
    ? newspaperExpiresAtFromTerm(newsTerm)
    : (sub.expires_at || newspaperExpiresAtFromTerm('monthly'));

  const { error } = await supabase
    .from('subscriptions')
    .update({ newspaper_addon: true, newspaper_expires_at, remark: mergedRemark })
    .eq('user_id', user_id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Newspaper add-on granted', newspaper_addon: true, newspaper_term: newsTerm, newspaper_expires_at });
};

// Admin: revoke subscription
exports.adminRevoke = async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(422).json({ error: 'user_id is required' });
  const { error } = await supabase
    .from('subscriptions').update({ status: 'cancelled', newspaper_addon: false, newspaper_expires_at: null }).eq('user_id', user_id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Subscription and newspaper addon revoked' });
};

/** User/Pramukh: cancel own plan + newspaper add-on (no refund). */
exports.cancelMySubscription = async (req, res) => {
  const userId = req.user.id;
  const { data: sub, error: findErr } = await supabase
    .from('subscriptions')
    .select('id, status')
    .eq('user_id', userId)
    .maybeSingle();

  if (findErr) return res.status(400).json({ error: findErr.message });
  if (!sub) return res.status(404).json({ error: 'No subscription found' });
  if (sub.status !== 'active') {
    return res.status(400).json({ error: 'No active subscription to disable' });
  }

  const { error } = await supabase
    .from('subscriptions')
    .update({ status: 'cancelled', newspaper_addon: false, newspaper_expires_at: null })
    .eq('user_id', userId);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Subscription and newspaper plan disabled', status: 'cancelled', newspaper_addon: false });
};

// Admin: list subscriptions with user details (search + pagination for large directories)
exports.adminGetAll = async (req, res) => {
  const search = (req.query.q || '').trim();
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  let userIds = null;
  if (search) {
    const term = `%${search}%`;
    const { data: matchedUsers, error: uErr } = await supabase
      .from('users')
      .select('id')
      .or(`email.ilike.${term},name.ilike.${term}`);
    if (uErr) return res.status(400).json({ error: uErr.message });
    userIds = (matchedUsers || []).map((u) => u.id);
    if (userIds.length === 0) return res.json([]);
  }

  let query = supabase
    .from('subscriptions')
    .select('*, remark, paid_amount, promo_code_used, users(name, email, role, building_id, buildings(name))')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (userIds) query = query.in('user_id', userIds);

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json((data || []).map((row) => ({
    ...row,
    gateway_payment_id: row.razorpay_payment_id || null,
    gateway_order_id: row.razorpay_order_id || null,
  })));
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

  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    await supabase.from('subscriptions').update({ status: 'expired' }).eq('user_id', req.user.id);
    return res.status(402).json({ error: 'subscription_expired', message: 'Your subscription has expired' });
  }

  next();
};

// Callback from Easebuzz for subscription/newspaper add-on
exports.easebuzzCallback = async (req, res) => {
  const { type, plan: queryPlan, user_id: queryUserId, promo_id, include_newspaper, txn_id } = req.query;
  const {
    mergeGatewayPayload,
    resolvePaymentOutcome,
    redirectToApp,
  } = require('../utils/easebuzzHelper');
  const gatewayPayload = mergeGatewayPayload(req);

  const user_id = queryUserId || gatewayPayload?.udf1 || null;
  const plan = queryPlan || gatewayPayload?.udf2 || null;

  try {
    const outcome = await resolvePaymentOutcome(gatewayPayload, txn_id);

    if (!outcome.ok) {
      console.warn('[Easebuzz subscription callback] payment not completed', {
        status: outcome.status,
        reason: outcome.reason,
        txn_id,
        hashOk: outcome.hashOk,
        easepayid: gatewayPayload?.easepayid || null,
      });
      const reasonParam = encodeURIComponent(String(outcome.reason || '').slice(0, 120));
      return redirectToApp(res, `mybuilding://subscribe?status=failed&reason=${reasonParam}`);
    }

    const paymentId = gatewayPayload?.easepayid || gatewayPayload?.payment_id || gatewayPayload?.txnid || txn_id;

    if (type === 'newspaper_addon') {
      if (!user_id) {
        console.error('[Easebuzz callback] newspaper_addon: user_id missing from query and udf1');
        return redirectToApp(res, 'mybuilding://subscribe?status=failed');
      }
      const addonPlan = plan || gatewayPayload?.udf2 || 'monthly';
      const addonCfg = await getPlanForPayment(addonPlan);
      const term = newspaperTermFromPlan(addonPlan, addonCfg);
      await supabase
        .from('subscriptions')
        .update({
          newspaper_addon: true,
          newspaper_expires_at: newspaperExpiresAtFromTerm(term),
        })
        .eq('user_id', user_id);

      return redirectToApp(res, 'mybuilding://subscribe?status=success');
    }

    // Subscription activation
    const now = new Date();
    const planCfg = await getPlanForPayment(plan);
    const months = planCfg?.months;
    const expires_at = months == null ? null
      : new Date(now.getFullYear(), now.getMonth() + months, now.getDate()).toISOString();

    const { data: existing } = await supabase
      .from('subscriptions').select('id').eq('user_id', user_id).single();

    const subscriptionRow = {
      user_id,
      plan,
      status: 'active',
      started_at: now.toISOString(),
      expires_at,
      razorpay_payment_id: paymentId,
      razorpay_order_id: gatewayPayload?.txnid || txn_id,
    };

    if (existing) {
      await supabase.from('subscriptions').update(subscriptionRow).eq('user_id', user_id);
    } else {
      await supabase.from('subscriptions').insert(subscriptionRow);
    }

    if (include_newspaper === '1') {
      const newsTerm = newspaperTermFromPlan(plan, planCfg);
      await supabase.from('subscriptions').update({
        newspaper_addon: true,
        newspaper_expires_at: expires_at || newspaperExpiresAtFromTerm(newsTerm),
      }).eq('user_id', user_id);
    }

    const paidAmountRupees = Math.round(Number(gatewayPayload?.amount || 0));
    const fallbackRupee = await getPlanRupeeBase(plan);
    if (promo_id) {
      const { markPromoUsed } = require('./promoController');
      await markPromoUsed(promo_id, user_id);
      const { data: promo } = await supabase.from('promo_codes').select('code').eq('id', promo_id).single();
      await supabase.from('subscriptions').update({
        paid_amount: paidAmountRupees || null,
        promo_code_used: promo?.code || null,
      }).eq('user_id', user_id);
    } else {
      await supabase.from('subscriptions').update({
        paid_amount: paidAmountRupees || fallbackRupee || null,
        promo_code_used: null,
      }).eq('user_id', user_id);
    }

    return redirectToApp(res, 'mybuilding://subscribe?status=success');
  } catch (err) {
    console.error("Easebuzz callback error:", err);
    return redirectToApp(res, 'mybuilding://subscribe?status=failed');
  }
};
// Backward compatibility for existing route wiring
exports.phonepeCallback = exports.easebuzzCallback;

// ── Newspaper Add-On ─────────────────────────────────────────────────────────

const NEWSPAPER_ADDON_AMOUNT = 300; // ₹3 in paise

// Create Easebuzz order for newspaper add-on
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

  const addonCfg = await getPlanForPayment(addonPlan);
  if (!addonCfg) {
    return res.status(422).json({ error: 'Invalid plan for newspaper add-on' });
  }
  if (!addonCfg.allow_newspaper_addon) {
    return res.status(400).json({ error: 'Newspaper add-on is not available for this plan' });
  }

  let addonAmount = addonCfg.newspaper_addon_paise;
  if (addonAmount == null || Number.isNaN(addonAmount)) {
    if (addonPlan === 'yearly' || addonCfg.months === 12) addonAmount = 3600;
    else addonAmount = NEWSPAPER_ADDON_AMOUNT;
  }

  try {
    const { initiatePayment } = require('../utils/easebuzzHelper');
    // Easebuzz requires txnid to be alphanumeric only, max 25 chars.
    const merchantTransactionId = `N${req.user.id.replace(/-/g, '').substring(0, 10)}${Date.now()}`.substring(0, 25);
    const backendUrl = getPaymentCallbackUrl(req);
    if (!backendUrl) return res.status(500).json({ error: 'Cannot resolve backend URL from request' });

    // Keep surl short — Easebuzz validates URL length. type + txn_id are enough; user_id is in udf1.
    const redirectUrl = `${backendUrl}/api/subscriptions/easebuzz-callback?type=newspaper_addon&txn_id=${merchantTransactionId}`;
    const { paymentUrl } = await initiatePayment({
      txnid: merchantTransactionId,
      amount: addonAmount / 100,
      productinfo: `Newspaper Addon ${addonPlan}`,
      firstname: req.user.name || 'User',
      email: req.user.email || 'customer@example.com',
      phone: req.user.phone || '9999999999',
      surl: redirectUrl,
      furl: redirectUrl,
      udf1: req.user.id,
      udf2: addonPlan,
      udf4: 'newspaper_addon',
      udf5: 'adminsubscription',
    });

    res.json({
      order_id: merchantTransactionId,
      amount: addonAmount,
      checkout_url: paymentUrl
    });
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
    .update({ newspaper_addon: false, newspaper_expires_at: null })
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

  if (!plan || !plan.is_active) return res.status(404).json({ error: 'Plan not found or inactive' });

  const now = new Date();
  const months = plan.months;
  const expires_at = months == null ? null
    : new Date(now.getFullYear(), now.getMonth() + months, now.getDate()).toISOString();

  const { error } = await supabase
    .from('subscriptions')
    .update({ plan: plan.slug, status: 'active', started_at: now.toISOString(), expires_at })
    .eq('user_id', req.user.id);

  if (error) return res.status(400).json({ error: error.message });

  const { data: updated } = await supabase
    .from('subscriptions').select('*').eq('user_id', req.user.id).single();

  res.json({ message: 'Plan upgraded', subscription: updated });
};
