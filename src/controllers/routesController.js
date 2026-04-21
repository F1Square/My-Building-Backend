/**
 * Razorpay Routes — Linked Account Management
 *
 * Flow:
 * 1. Admin/Pramukh creates a linked account for their building (once)
 * 2. The linked account ID is stored in building_bank_details.razorpay_account_id
 * 3. When a maintenance payment order is created, a transfer is added to route
 *    the full amount to the society's linked account
 */

const Razorpay = require('razorpay');
const supabase = require('../supabase');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ── Create or fetch linked account for a building ──────────────────────────
exports.createLinkedAccount = async (req, res) => {
  const building_id = req.user.building_id || req.body.building_id;
  if (!building_id) return res.status(400).json({ error: 'building_id is required' });

  const {
    legal_business_name,
    business_type,       // route, individual, etc.
    contact_name,
    contact_email,
    contact_mobile,
    profile_category,   // e.g. "housing_society"
    profile_subcategory,
    legal_info_pan,
    legal_info_gst,
  } = req.body;

  if (!legal_business_name || !contact_email || !contact_mobile)
    return res.status(422).json({ error: 'legal_business_name, contact_email and contact_mobile are required' });

  // Check if already exists
  const { data: existing } = await supabase
    .from('building_bank_details')
    .select('razorpay_account_id')
    .eq('building_id', building_id)
    .single();

  if (existing?.razorpay_account_id) {
    return res.json({ message: 'Linked account already exists', account_id: existing.razorpay_account_id });
  }

  try {
    // Create linked account via Razorpay Routes API
    const account = await razorpay.accounts.create({
      email: contact_email,
      phone: contact_mobile,
      profile: {
        category: profile_category || 'housing_society',
        subcategory: profile_subcategory || 'housing_society',
        addresses: {
          registered: {
            street1: req.body.address || 'Society Address',
            city: req.body.city || 'City',
            state: req.body.state || 'State',
            postal_code: req.body.pincode || '380001',
            country: 'IN',
          },
        },
      },
      type: 'route',
      legal_business_name,
      business_type: business_type || 'individual',
      contact_name,
      legal_info: {
        pan: legal_info_pan || undefined,
        gst: legal_info_gst || undefined,
      },
    });

    // Store the linked account ID
    const { error: upsertErr } = await supabase
      .from('building_bank_details')
      .upsert({
        building_id,
        razorpay_account_id: account.id,
        updated_at: new Date().toISOString()
      }, { onConflict: 'building_id' });

    if (upsertErr) console.error('DB upsert error:', upsertErr);

    res.status(201).json({ message: 'Linked account created', account_id: account.id, account });
  } catch (err) {
    console.error('Razorpay linked account error:', JSON.stringify(err?.error || err?.message || err));
    res.status(500).json({ error: err?.error?.description || err?.message || 'Failed to create linked account' });
  }
};

// ── Add bank account to a linked account ──────────────────────────────────
exports.addBankAccount = async (req, res) => {
  const building_id = req.user.building_id || req.body.building_id;
  if (!building_id) return res.status(400).json({ error: 'building_id is required' });

  const { account_number, ifsc, beneficiary_name } = req.body;
  if (!account_number || !ifsc || !beneficiary_name)
    return res.status(422).json({ error: 'account_number, ifsc and beneficiary_name are required' });

  const { data: bankRow } = await supabase
    .from('building_bank_details')
    .select('razorpay_account_id')
    .eq('building_id', building_id)
    .single();

  if (!bankRow?.razorpay_account_id)
    return res.status(400).json({ error: 'No linked account found. Create one first.' });

  try {
    const stakeholder = await razorpay.stakeholders.create(bankRow.razorpay_account_id, {
      name: beneficiary_name,
      relationship: { director: true },
    });

    // Add bank account to the linked account
    const bankAccount = await fetch(
      `https://api.razorpay.com/v2/accounts/${bankRow.razorpay_account_id}/bank_account`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Basic ' + Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64'),
        },
        body: JSON.stringify({
          ifsc_code: ifsc,
          beneficiary_name,
          account_number,
          account_type: 'savings',
        }),
      }
    ).then(r => r.json());

    if (bankAccount.error) throw new Error(bankAccount.error.description);

    // Also update our DB with the bank details
    await supabase.from('building_bank_details').update({
      bank_account: account_number,
      bank_ifsc: ifsc,
      updated_at: new Date().toISOString(),
    }).eq('building_id', building_id);

    res.json({ message: 'Bank account linked', bank_account: bankAccount });
  } catch (err) {
    console.error('Add bank account error:', err);
    res.status(500).json({ error: err.message || 'Failed to add bank account' });
  }
};

// ── Get linked account status ──────────────────────────────────────────────
exports.getLinkedAccount = async (req, res) => {
  const building_id = req.user.building_id || req.query.building_id;
  if (!building_id) return res.status(400).json({ error: 'building_id is required' });

  const { data: bankRow } = await supabase
    .from('building_bank_details')
    .select('razorpay_account_id, bank_name, bank_account, bank_ifsc')
    .eq('building_id', building_id)
    .maybeSingle();

  if (!bankRow?.razorpay_account_id)
    return res.json({ linked: false });

  try {
    const account = await razorpay.accounts.fetch(bankRow.razorpay_account_id);
    res.json({ linked: true, account_id: bankRow.razorpay_account_id, account });
  } catch (err) {
    // Account ID exists in DB but Razorpay fetch failed — still show as linked
    res.json({ linked: true, account_id: bankRow.razorpay_account_id, account: null, error: err.message });
  }
};

// ── Transfer funds to linked account (called after payment capture) ────────
// This is called internally from maintenanceController after payment success
exports.transferToLinkedAccount = async (payment_id, account_id, amount_paise, notes = {}) => {
  try {
    const transfer = await razorpay.payments.transfer(payment_id, {
      transfers: [
        {
          account: account_id,
          amount: amount_paise,
          currency: 'INR',
          notes,
          on_hold: 0, // release immediately
        },
      ],
    });
    return { success: true, transfer: transfer[0] };
  } catch (err) {
    console.error('Transfer error:', err);
    return { success: false, error: err.error?.description || err.message };
  }
};
