const supabase = require('../supabase');
const Razorpay = require('razorpay');
const crypto = require('crypto');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const PLANS = {
  monthly:  { amount: 1500,   label: '₹15/month',    months: 1  },   // paise
  yearly:   { amount: 15000,  label: '₹150/year',    months: 12 },
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

// Create Razorpay order for subscription
exports.createOrder = async (req, res) => {
  const { plan } = req.body;
  if (!PLANS[plan]) return res.status(422).json({ error: 'Invalid plan. Choose monthly or lifetime' });

  const planInfo = PLANS[plan];
  try {
    const order = await razorpay.orders.create({
      amount: planInfo.amount,
      currency: 'INR',
      receipt: `sub_${req.user.id.slice(0, 20)}`,
      notes: { user_id: req.user.id, plan, user_email: req.user.email },
    });
    res.json({ order_id: order.id, amount: order.amount, key: process.env.RAZORPAY_KEY_ID, plan });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create order: ' + (err.error?.description || err.message) });
  }
};

// Verify payment and activate subscription
exports.verifyAndActivate = async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !PLANS[plan])
    return res.status(422).json({ error: 'Missing required fields' });

  // Verify signature
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (expected !== razorpay_signature)
    return res.status(400).json({ error: 'Payment verification failed' });

  const now = new Date();
  const expires_at = plan === 'lifetime' ? null
    : new Date(now.getFullYear(), now.getMonth() + (PLANS[plan].months || 1), now.getDate()).toISOString();

  // Upsert subscription
  const { data: existing } = await supabase
    .from('subscriptions').select('id').eq('user_id', req.user.id).single();

  const payload = {
    user_id: req.user.id,
    plan,
    status: 'active',
    started_at: now.toISOString(),
    expires_at,
    razorpay_payment_id,
    razorpay_order_id,
  };

  let error;
  if (existing) {
    ({ error } = await supabase.from('subscriptions').update(payload).eq('user_id', req.user.id));
  } else {
    ({ error } = await supabase.from('subscriptions').insert(payload));
  }

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Subscription activated', plan, expires_at });
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
    .from('subscriptions').update({ status: 'cancelled' }).eq('user_id', user_id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Subscription revoked' });
};

// Admin: get all subscriptions with user details
exports.adminGetAll = async (req, res) => {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*, remark, users(name, email, role, building_id, buildings(name))')
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

// Serve Razorpay checkout HTML for subscription
exports.checkoutPage = (req, res) => {
  const { order_id } = req.params;
  const { amount, key, plan, user_id } = req.query;
  const backendUrl = process.env.BACKEND_URL || '';
  const callbackUrl = `${backendUrl}/api/subscriptions/callback?plan=${plan}&user_id=${user_id}`;
  const planLabel = plan === 'lifetime' ? '₹1,500 Lifetime' : plan === 'yearly' ? '₹150/year' : '₹15/month';

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <title>My Building — Subscribe</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, sans-serif; background: #f5f7fa; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { background: #fff; border-radius: 16px; padding: 32px 24px; max-width: 400px; width: 100%; box-shadow: 0 4px 24px rgba(0,0,0,0.08); text-align: center; }
    .logo { font-size: 40px; margin-bottom: 8px; }
    .title { font-size: 22px; font-weight: 800; color: #1E3A8A; margin-bottom: 4px; }
    .plan { background: #EFF6FF; color: #1E3A8A; font-weight: 700; border-radius: 8px; padding: 6px 14px; display: inline-block; margin-bottom: 20px; }
    .amount { font-size: 36px; font-weight: 800; color: #111827; margin-bottom: 24px; }
    .btn { background: #1E3A8A; color: #fff; border: none; border-radius: 12px; padding: 16px 32px; font-size: 16px; font-weight: 700; cursor: pointer; width: 100%; }
    .btn:disabled { opacity: 0.6; }
    .status { margin-top: 20px; font-size: 14px; color: #6B7280; }
    .secure { font-size: 12px; color: #9CA3AF; margin-top: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">🏢</div>
    <div class="title">My Building</div>
    <div class="plan">${planLabel}</div>
    <div class="amount">₹${Math.round(Number(amount) / 100).toLocaleString('en-IN')}</div>
    <button class="btn" id="payBtn" onclick="startPayment()">Pay Now</button>
    <div class="status" id="status"></div>
    <div class="secure">🔒 Secured by Razorpay</div>
  </div>
  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
  <script>
    function startPayment() {
      var btn = document.getElementById('payBtn');
      btn.disabled = true; btn.textContent = 'Opening...';
      var options = {
        key: "${key}", amount: ${amount}, currency: "INR",
        order_id: "${order_id}", name: "My Building",
        description: "${planLabel} Subscription",
        theme: { color: "#1E3A8A" },
        handler: function(response) {
          document.getElementById('status').textContent = 'Activating subscription...';
          fetch('${callbackUrl}', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_order_id: response.razorpay_order_id,
              razorpay_signature: response.razorpay_signature
            })
          })
          .then(r => r.json())
          .then(data => {
            if (data.success) {
              document.getElementById('status').textContent = '✅ Subscription activated!';
              setTimeout(() => { window.location.href = 'mybuilding://subscription?status=success'; }, 1500);
            } else {
              document.getElementById('status').textContent = '❌ ' + (data.error || 'Activation failed');
              btn.disabled = false; btn.textContent = 'Retry';
            }
          })
          .catch(() => {
            document.getElementById('status').textContent = '❌ Network error';
            btn.disabled = false; btn.textContent = 'Retry';
          });
        },
        modal: { ondismiss: function() { btn.disabled = false; btn.textContent = 'Pay Now'; window.location.href = 'mybuilding://subscription?status=cancelled'; } }
      };
      var rzp = new Razorpay(options);
      rzp.on('payment.failed', function(r) {
        document.getElementById('status').textContent = '❌ ' + (r.error.description || 'Payment failed');
        btn.disabled = false; btn.textContent = 'Try Again';
      });
      rzp.open();
    }
    window.onload = function() { startPayment(); };
  </script>
</body>
</html>`);
};

// Callback from checkout page
exports.paymentCallback = async (req, res) => {
  const { plan, user_id } = req.query;
  const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;

  if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature)
    return res.json({ success: false, error: 'Missing payment data' });

  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (expected !== razorpay_signature)
    return res.json({ success: false, error: 'Signature mismatch' });

  const now = new Date();
  const expires_at = plan === 'lifetime' ? null
    : new Date(now.getFullYear(), now.getMonth() + (PLANS[plan]?.months || 1), now.getDate()).toISOString();

  const { data: existing } = await supabase
    .from('subscriptions').select('id').eq('user_id', user_id).single();

  const payload = { user_id, plan, status: 'active', started_at: now.toISOString(), expires_at, razorpay_payment_id, razorpay_order_id };

  let error;
  if (existing) {
    ({ error } = await supabase.from('subscriptions').update(payload).eq('user_id', user_id));
  } else {
    ({ error } = await supabase.from('subscriptions').insert(payload));
  }

  if (error) return res.json({ success: false, error: error.message });
  res.json({ success: true });
};
