const supabase = require('../supabase');
const { normalizeBankWing, pickBankDetailsForWing } = require('../utils/validators');

// ── Get account status ──────────────────────────────────────────────
exports.getAccountStatus = async (req, res) => {
  const building_id = req.user.building_id || req.query.building_id;
  if (!building_id) return res.status(400).json({ error: 'building_id is required' });

  const wing = normalizeBankWing(req.query.wing || req.user?.wing);
  const { data: bankRows } = await supabase
    .from('building_bank_details')
    .select('wing, razorpay_account_id, bank_name, bank_account, bank_ifsc, beneficiary_name')
    .eq('building_id', building_id);

  const bankRow = pickBankDetailsForWing(bankRows || [], wing);

  if (!bankRow?.razorpay_account_id) {
    return res.json({
      connected: false,
      settlement_wing: wing,
      message: `No account connected for wing ${wing}. Please submit your Account ID.`,
    });
  }

  res.json({
    connected: true,
    settlement_wing: normalizeBankWing(bankRow.wing),
    account_id: bankRow.razorpay_account_id,
    bank_details: {
      wing: normalizeBankWing(bankRow.wing),
      bank_name: bankRow.bank_name,
      bank_account: bankRow.bank_account,
      bank_ifsc: bankRow.bank_ifsc,
      beneficiary_name: bankRow.beneficiary_name,
    },
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
