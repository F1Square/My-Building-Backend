const supabase = require('../supabase');
const ns = require('./notificationService');

/**
 * Called from maintenanceController.addBill after payment records are inserted.
 * For each member, applies available advance credit to their new payment record.
 *
 * @param {string} building_id
 * @param {Array<{id: string}>} members
 * @param {{id: string, amount: number}} bill
 */
async function settleAdvanceCredit(building_id, members, bill) {
  if (!members?.length) return;

  for (const member of members) {
    try {
      // Fetch credit balance for this member+building
      const { data: creditRow } = await supabase
        .from('advance_credit_balance')
        .select('credit_balance')
        .eq('user_id', member.id)
        .eq('building_id', building_id)
        .single();

      const credit = Number(creditRow?.credit_balance || 0);
      if (credit <= 0) continue;

      const billAmount = Number(bill.amount);

      if (credit >= billAmount) {
        // Full settlement
        const newBalance = credit - billAmount;

        await supabase
          .from('maintenance_payments')
          .update({
            status: 'paid',
            payment_method: 'advance',
            paid_at: new Date().toISOString(),
          })
          .eq('bill_id', bill.id)
          .eq('user_id', member.id);

        await supabase
          .from('advance_credit_balance')
          .update({ credit_balance: newBalance, updated_at: new Date().toISOString() })
          .eq('user_id', member.id)
          .eq('building_id', building_id);

        await supabase.from('advance_credit_ledger').insert({
          user_id: member.id,
          building_id,
          transaction_type: 'debit',
          amount: billAmount,
          balance_after: newBalance,
          bill_id: bill.id,
          description: 'Auto-settled bill via advance credit',
        });

        await ns.notifyUser(member.id, {
          title: '✅ Bill Auto-Settled',
          body: `Your maintenance bill of ₹${billAmount.toLocaleString('en-IN')} has been paid using your advance credit. Remaining credit: ₹${newBalance.toLocaleString('en-IN')}`,
          type: 'advance_settled',
          meta: { bill_id: bill.id },
        });
      } else {
        // Partial settlement: 0 < credit < billAmount
        const remaining = billAmount - credit;

        await supabase
          .from('maintenance_payments')
          .update({
            status: 'partial',
            advance_credit_applied: credit,
            amount_due: remaining,
          })
          .eq('bill_id', bill.id)
          .eq('user_id', member.id);

        await supabase
          .from('advance_credit_balance')
          .update({ credit_balance: 0, updated_at: new Date().toISOString() })
          .eq('user_id', member.id)
          .eq('building_id', building_id);

        await supabase.from('advance_credit_ledger').insert({
          user_id: member.id,
          building_id,
          transaction_type: 'debit',
          amount: credit,
          balance_after: 0,
          bill_id: bill.id,
          description: 'Partial advance credit applied',
        });

        await ns.notifyUser(member.id, {
          title: '⚡ Partial Advance Credit Applied',
          body: `₹${credit.toLocaleString('en-IN')} applied from your advance credit. ₹${remaining.toLocaleString('en-IN')} remaining to pay.`,
          type: 'advance_partial',
          meta: { bill_id: bill.id },
        });
      }
    } catch (err) {
      console.error(`[settleAdvanceCredit] Error processing member ${member.id}:`, err.message);
      // Do not rethrow — bill creation must not fail due to settlement errors
    }
  }
}

module.exports = settleAdvanceCredit;
