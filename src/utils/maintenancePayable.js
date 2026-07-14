/**
 * Shared payable total for maintenance payment records.
 * Matches My Bill (BillCard): base = record.amount; add bill penalty only when
 * category is maintenance and due_date has passed.
 */

function isDueDatePassed(dueDate) {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date();
}

/**
 * @param {object} record - maintenance_payments row with optional maintenance_bills join
 * @returns {{ baseAmount: number, penaltyAmount: number, totalAmount: number, isOverdue: boolean }}
 */
function computeMaintenancePayable(record) {
  const bill = record?.maintenance_bills || {};
  const category = record?.category || bill.category || 'maintenance';
  const baseAmount = Number(record?.amount ?? 0) || 0;

  // Paid rows: use amounts frozen at charge time.
  if (record?.status === 'paid') {
    const totalAmount = Number(record.total_amount ?? record.amount ?? 0) || 0;
    const penaltyAmount = Number(record.penalty_amount ?? 0) || 0;
    return {
      baseAmount,
      penaltyAmount,
      totalAmount,
      isOverdue: false,
    };
  }

  // Pending: prefer bill.penalty_amount (source of truth), fall back to payment row.
  const configuredPenalty = Number(
    bill.penalty_amount != null ? bill.penalty_amount : (record?.penalty_amount ?? 0),
  ) || 0;

  const duePassed = isDueDatePassed(bill.due_date);
  const applyPenalty = category === 'maintenance' && duePassed && configuredPenalty > 0;
  const penaltyAmount = applyPenalty ? configuredPenalty : 0;

  return {
    baseAmount,
    penaltyAmount,
    totalAmount: baseAmount + penaltyAmount,
    isOverdue: applyPenalty,
  };
}

module.exports = { computeMaintenancePayable, isDueDatePassed };
