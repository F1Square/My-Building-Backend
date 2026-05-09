const cron = require('node-cron');
const supabase = require('../supabase');
const { notifyUser } = require('./notificationService');

// Activity logs older than this are purged daily to keep the table small
// and queries fast. Lines up with the "clears after 6 days" UI label.
const ACTIVITY_LOG_RETENTION_DAYS = 6;

/**
 * Scheduler for automated jobs
 * - Bill Due Date Reminders: every day at 10:00 AM
 * - Activity-log purge:      every day at 03:30
 */
function startScheduler() {
  console.log('⏰ Notification scheduler started');

  // Purge stale activity logs once per day. Doing this on a cron (instead of
  // on every admin GET) means a single bulk DELETE per day, no matter how
  // often the admin opens the screen.
  cron.schedule('30 3 * * *', async () => {
    try {
      const cutoff = new Date(
        Date.now() - ACTIVITY_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000
      ).toISOString();
      const { error } = await supabase
        .from('user_activity_logs')
        .delete()
        .lt('created_at', cutoff);
      if (error) {
        console.error('[Scheduler] activity-log purge failed:', error.message);
      } else {
        console.log(`[Scheduler] Purged activity logs older than ${ACTIVITY_LOG_RETENTION_DAYS} days`);
      }
    } catch (err) {
      console.error('[Scheduler] activity-log purge crashed:', err);
    }
  });

  // Check for bills due tomorrow (Runs every day at 10:00 AM)
  cron.schedule('0 10 * * *', async () => {
    try {
      console.log('[Scheduler] Checking for upcoming bill due dates...');
      
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split('T')[0];

      // Find all bills due tomorrow
      const { data: bills, error: billsError } = await supabase
        .from('maintenance_bills')
        .select('id, description, category, due_date')
        .eq('due_date', tomorrowStr);

      if (billsError) throw billsError;
      if (!bills?.length) return;

      console.log(`[Scheduler] Found ${bills.length} bills due tomorrow. Sending reminders...`);

      for (const bill of bills) {
        // Find all pending payments for this bill
        const { data: payments, error: paymentsError } = await supabase
          .from('maintenance_payments')
          .select('user_id, amount')
          .eq('bill_id', bill.id)
          .eq('status', 'pending');

        if (paymentsError) {
          console.error(`[Scheduler] Error fetching payments for bill ${bill.id}:`, paymentsError);
          continue;
        }

        for (const p of payments) {
          await notifyUser(p.user_id, {
            title: '⏰ Payment Reminder',
            body: `Tomorrow is the last day to pay for "${bill.description}". Amount: ₹${p.amount}. Please pay fast!`,
            type: 'reminder',
            meta: { bill_id: bill.id }
          });
        }
      }
    } catch (err) {
      console.error('[Scheduler] Error in bill reminder job:', err);
    }
  });
}

module.exports = { startScheduler };
