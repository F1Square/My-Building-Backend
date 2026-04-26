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
    business_type,
    contact_name,
    contact_email,
    contact_mobile,
    address,
    address2,
    city,
    state,
    pincode,
    profile_category,
    profile_subcategory,
    legal_info_pan,
    legal_info_gst,
  } = req.body;

  // Validate required fields per Razorpay documentation
  if (!legal_business_name || legal_business_name.length < 4 || legal_business_name.length > 200)
    return res.status(422).json({ error: 'legal_business_name is required (4-200 characters)' });
  
  if (!contact_email)
    return res.status(422).json({ error: 'contact_email is required' });
  
  if (!contact_mobile || contact_mobile.length < 8 || contact_mobile.length > 15)
    return res.status(422).json({ error: 'contact_mobile is required (8-15 characters)' });
  
  if (!contact_name || contact_name.length < 4)
    return res.status(422).json({ error: 'contact_name is required (min 4 characters)' });
  
  if (!address || !address2 || !city || !state || !pincode)
    return res.status(422).json({ error: 'Complete address (street1, street2, city, state, pincode) is required' });

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
    const accountPayload = {
      email: contact_email,
      phone: contact_mobile,
      type: 'route',
      legal_business_name,
      business_type: business_type || 'society',
      contact_name,
      profile: {
        category: profile_category || 'others',
        subcategory: profile_subcategory || 'others',
        addresses: {
          registered: {
            street1: address,
            street2: address2,
            city,
            state,
            postal_code: pincode,
            country: 'IN',
          },
        },
      },
    };

    // Add legal info only if provided
    if (legal_info_pan || legal_info_gst) {
      accountPayload.legal_info = {};
      if (legal_info_pan) accountPayload.legal_info.pan = legal_info_pan;
      if (legal_info_gst) accountPayload.legal_info.gst = legal_info_gst;
    }

    const account = await razorpay.accounts.create(accountPayload);

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
    .select('razorpay_account_id, bank_name, bank_account, bank_ifsc, beneficiary_name')
    .eq('building_id', building_id)
    .maybeSingle();

  if (!bankRow?.razorpay_account_id)
    return res.json({ linked: false });

  try {
    const account = await razorpay.accounts.fetch(bankRow.razorpay_account_id);
    res.json({ 
      linked: true, 
      account_id: bankRow.razorpay_account_id, 
      account,
      bank_details: {
        bank_name: bankRow.bank_name,
        bank_account: bankRow.bank_account,
        bank_ifsc: bankRow.bank_ifsc,
        beneficiary_name: bankRow.beneficiary_name
      }
    });
  } catch (err) {
    // Account ID exists in DB but Razorpay fetch failed — still show as linked
    res.json({ 
      linked: true, 
      account_id: bankRow.razorpay_account_id, 
      account: null, 
      error: err.message,
      bank_details: {
        bank_name: bankRow.bank_name,
        bank_account: bankRow.bank_account,
        bank_ifsc: bankRow.bank_ifsc,
        beneficiary_name: bankRow.beneficiary_name
      }
    });
  }
};

// ── Get all linked accounts (Admin only) ──────────────────────────────────
exports.getAllLinkedAccounts = async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    const { data: bankDetails } = await supabase
      .from('building_bank_details')
      .select(`
        building_id,
        razorpay_account_id,
        bank_name,
        bank_account,
        bank_ifsc,
        beneficiary_name,
        contact_name,
        contact_email,
        contact_mobile,
        updated_at,
        buildings(name, address)
      `)
      .not('razorpay_account_id', 'is', null);

    const accountsWithStatus = await Promise.all(
      bankDetails.map(async (detail) => {
        try {
          const account = await razorpay.accounts.fetch(detail.razorpay_account_id);
          return {
            ...detail,
            razorpay_status: account.status,
            razorpay_account: account
          };
        } catch (err) {
          return {
            ...detail,
            razorpay_status: 'error',
            razorpay_error: err.message
          };
        }
      })
    );

    res.json(accountsWithStatus);
  } catch (err) {
    console.error('Get all linked accounts error:', err);
    res.status(500).json({ error: 'Failed to fetch linked accounts' });
  }
};

// ── Manual transfer retry for debugging ──────────────────────────────────
exports.retryTransfer = async (req, res) => {
  const { payment_record_id } = req.body;
  
  if (!payment_record_id) {
    return res.status(400).json({ error: 'payment_record_id is required' });
  }

  try {
    // Get payment record
    const { data: payment } = await supabase
      .from('maintenance_payments')
      .select(`
        id, razorpay_payment_id, amount, total_amount, building_id,
        users(name), maintenance_bills(month, year)
      `)
      .eq('id', payment_record_id)
      .eq('status', 'paid')
      .single();

    if (!payment) {
      return res.status(404).json({ error: 'Payment record not found or not paid' });
    }

    if (!payment.razorpay_payment_id) {
      return res.status(400).json({ error: 'No Razorpay payment ID found' });
    }

    // Get bank details
    const { data: bankRow } = await supabase
      .from('building_bank_details')
      .select('razorpay_account_id')
      .eq('building_id', payment.building_id)
      .single();

    if (!bankRow?.razorpay_account_id) {
      return res.status(400).json({ error: 'No linked account found for this building' });
    }

    // Attempt transfer
    const amountPaise = Math.round(Number(payment.total_amount || payment.amount) * 100);
    const result = await exports.transferToLinkedAccount(
      payment.razorpay_payment_id,
      bankRow.razorpay_account_id,
      amountPaise,
      {
        record_id: payment_record_id,
        building_id: payment.building_id,
        bill_period: `${payment.maintenance_bills?.month}/${payment.maintenance_bills?.year}`,
        retry: true
      }
    );

    if (result.success) {
      // Update payment record with transfer ID
      await supabase.from('maintenance_payments')
        .update({ 
          razorpay_transfer_id: result.transfer?.id,
          transfer_completed_at: new Date().toISOString(),
          transfer_error: null
        })
        .eq('id', payment_record_id);

      res.json({ 
        success: true, 
        message: 'Transfer completed successfully',
        transfer_id: result.transfer?.id,
        amount: amountPaise / 100
      });
    } else {
      // Update with error
      await supabase.from('maintenance_payments')
        .update({ 
          transfer_error: result.error,
          transfer_attempted_at: new Date().toISOString()
        })
        .eq('id', payment_record_id);

      res.status(400).json({ 
        success: false, 
        error: result.error,
        error_code: result.error_code,
        error_field: result.error_field
      });
    }
  } catch (error) {
    console.error('Retry transfer error:', error);
    res.status(500).json({ error: 'Failed to retry transfer' });
  }
};

// ── Transfer funds to linked account (called after payment capture) ────────
// This is called internally from maintenanceController after payment success
exports.transferToLinkedAccount = async (payment_id, account_id, amount_paise, notes = {}) => {
  try {
    console.log('[Routes] Transfer request:', {
      payment_id,
      account_id,
      amount_paise,
      notes
    });

    // Validate inputs
    if (!payment_id || !account_id || !amount_paise) {
      throw new Error('Missing required parameters: payment_id, account_id, or amount_paise');
    }

    if (amount_paise < 100) {
      throw new Error('Amount must be at least ₹1 (100 paise)');
    }

    // Create transfer using Razorpay API
    const transferPayload = {
      transfers: [
        {
          account: account_id,
          amount: amount_paise,
          currency: 'INR',
          notes,
          on_hold: 0, // release immediately
        },
      ],
    };

    console.log('[Routes] Transfer payload:', transferPayload);

    const transfer = await razorpay.payments.transfer(payment_id, transferPayload);
    
    console.log('[Routes] Transfer response:', transfer);

    if (transfer && transfer.length > 0) {
      return { success: true, transfer: transfer[0] };
    } else {
      throw new Error('No transfer created in response');
    }
  } catch (err) {
    console.error('[Routes] Transfer error details:', {
      error: err,
      message: err.message,
      description: err.error?.description,
      code: err.error?.code,
      field: err.error?.field,
      source: err.error?.source,
      step: err.error?.step,
      reason: err.error?.reason
    });
    
    return { 
      success: false, 
      error: err.error?.description || err.message || 'Unknown transfer error',
      error_code: err.error?.code,
      error_field: err.error?.field
    };
  }
};
