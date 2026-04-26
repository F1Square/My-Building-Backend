/**
 * Simplified Razorpay Payment System
 *
 * Flow:
 * 1. Society manually creates Razorpay account and submits Account ID
 * 2. Payment transfers are made to the submitted Account ID
 * 3. Society views all transactions in their Razorpay dashboard
 */

const Razorpay = require('razorpay');
const supabase = require('../supabase');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ── Get account status ──────────────────────────────────────────────
exports.getAccountStatus = async (req, res) => {
  const building_id = req.user.building_id || req.query.building_id;
  if (!building_id) return res.status(400).json({ error: 'building_id is required' });

  const { data: bankRow } = await supabase
    .from('building_bank_details')
    .select('razorpay_account_id, bank_name, bank_account, bank_ifsc, beneficiary_name')
    .eq('building_id', building_id)
    .maybeSingle();

  if (!bankRow?.razorpay_account_id) {
    return res.json({ 
      connected: false,
      message: 'No Razorpay account connected. Please submit your Account ID.' 
    });
  }

  res.json({ 
    connected: true, 
    account_id: bankRow.razorpay_account_id,
    bank_details: {
      bank_name: bankRow.bank_name,
      bank_account: bankRow.bank_account,
      bank_ifsc: bankRow.bank_ifsc,
      beneficiary_name: bankRow.beneficiary_name
    }
  });
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
      return res.status(400).json({ error: 'No Razorpay account connected for this building' });
    }

    // Attempt transfer
    const amountPaise = Math.round(Number(payment.total_amount || payment.amount) * 100);
    const result = await exports.transferToAccount(
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

// ── Transfer funds to account (called after payment capture) ────────
// This is called internally from maintenanceController after payment success
exports.transferToAccount = async (payment_id, account_id, amount_paise, notes = {}) => {
  try {
    console.log('[Transfer] Request:', {
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

    console.log('[Transfer] Payload:', transferPayload);

    const transfer = await razorpay.payments.transfer(payment_id, transferPayload);
    
    console.log('[Transfer] Response:', transfer);

    if (transfer && transfer.length > 0) {
      return { success: true, transfer: transfer[0] };
    } else {
      throw new Error('No transfer created in response');
    }
  } catch (err) {
    console.error('[Transfer] Error details:', {
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
