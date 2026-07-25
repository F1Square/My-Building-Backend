const supabase = require('../supabase');
const { normalizeBankWing } = require('./validators');

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * After a maintenance payment is confirmed, add an inflow entry
 * to the payer's wing expense tracker and update that wing's balance.
 */
async function addMaintenanceExpense(payment_record_id) {
  try {
    // Fetch full payment record
    const { data: record } = await supabase
      .from('maintenance_payments')
      .select('amount, penalty_amount, total_amount, building_id, user_id, payment_method, maintenance_bills(month, year, description, penalty_amount), users!maintenance_payments_user_id_fkey(name, flat_no, wing)')
      .eq('id', payment_record_id)
      .single();

    if (!record) return;

    const bill = record.maintenance_bills;
    const payer = record.users;
    const wing = normalizeBankWing(payer?.wing);
    const method = record.payment_method === 'cash' ? 'Cash' : 'Online';
    const period = bill ? `${MONTHS[bill.month]} ${bill.year}` : '';
    const flatInfo = payer?.flat_no ? ` (Flat ${payer.flat_no})` : '';

    const { data: fund } = await supabase
      .from('society_funds')
      .select('current_balance, opening_balance')
      .eq('building_id', record.building_id)
      .eq('wing', wing)
      .maybeSingle();

    const currentBalance = parseFloat(fund?.current_balance || 0);
    const billAmount = parseFloat(record.amount);
    const penaltyAmount = parseFloat(record.penalty_amount || 0);
    const totalAmount = billAmount + penaltyAmount;

    // Insert main maintenance inflow into the payer's wing ledger
    await supabase.from('expense_entries').insert({
      building_id: record.building_id,
      wing,
      type: 'inflow',
      amount: billAmount,
      description: `Maintenance ${period} — ${payer?.name || 'Resident'}${flatInfo} [${method}]`,
      category: 'Maintenance',
      date: new Date().toISOString().slice(0, 10),
      added_by: record.user_id,
      is_edited: false,
    });

    // Insert penalty inflow separately if applicable
    if (penaltyAmount > 0) {
      await supabase.from('expense_entries').insert({
        building_id: record.building_id,
        wing,
        type: 'inflow',
        amount: penaltyAmount,
        description: `Late Penalty — ${period} — ${payer?.name || 'Resident'}${flatInfo}`,
        category: 'Penalty',
        date: new Date().toISOString().slice(0, 10),
        added_by: record.user_id,
        is_edited: false,
      });
    }

    // Update wing balance with total
    const newBalance = currentBalance + totalAmount;
    await supabase.from('society_funds').upsert({
      building_id: record.building_id,
      wing,
      current_balance: newBalance,
      opening_balance: fund?.opening_balance ?? 0,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'building_id,wing' });

  } catch (err) {
    // Non-critical — don't fail the payment if expense logging fails
    console.error('[addMaintenanceExpense] error:', err.message);
  }
}

module.exports = addMaintenanceExpense;
