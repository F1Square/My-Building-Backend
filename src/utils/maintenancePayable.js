/**
 * Shared payable total for maintenance payment records.
 * Matches My Bill (BillCard): base = record.amount; add bill penalty only when
 * category is maintenance and the calendar day AFTER due_date has begun
 * (due date itself remains penalty-free).
 */

/** True only when today's local calendar date is strictly after the due date. */
function isDueDatePassed(dueDate) {
  if (!dueDate) return false;
  const raw = String(dueDate).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  let dueDay;
  if (m) {
    dueDay = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  } else {
    const d = new Date(dueDate);
    if (Number.isNaN(d.getTime())) return false;
    dueDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return today > dueDay;
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
