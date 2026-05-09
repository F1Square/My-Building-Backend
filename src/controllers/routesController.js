/**
 * Simplified Gateway Settlement System
 *
 * Flow:
 * 1. Society submits its payment routing account ID
 * 2. Maintenance collections are tagged for society settlement
 * 3. Subscriptions are tagged for admin settlement
 */

const supabase = require('../supabase');

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
      message: 'No account connected. Please submit your Account ID.' 
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
  res.status(400).json({ error: 'Manual transfer retry is disabled in current gateway-managed flow.' });
};

// ── Transfer funds to account (called after payment capture) ────────
exports.transferToAccount = async (payment_id, account_id, amount_paise, notes = {}) => {
  return { 
    success: false, 
    error: 'Direct transfer call is disabled in current gateway-managed flow.' 
  };
};
