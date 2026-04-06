const supabase = require('../supabase');

/**
 * Log a user action to the audit table.
 * Fire-and-forget — never throws, never blocks the request.
 *
 * @param {object} user  - req.user (id, name, role, building_id)
 * @param {string} action - short verb e.g. 'create_complaint', 'pay_bill'
 * @param {string} module - module name e.g. 'complaints', 'maintenance'
 * @param {object} detail - any extra context (ids, amounts, etc.)
 * @param {string} ip    - req.ip
 */
async function logActivity(user, action, module, detail = {}, ip = null) {
  try {
    await supabase.from('user_activity_logs').insert({
      user_id:     user?.id   || null,
      user_name:   user?.name || null,
      user_role:   user?.role || null,
      building_id: user?.building_id || null,
      action,
      module,
      detail,
      ip_address:  ip,
    });
  } catch {
    // silently ignore — logging must never break the main flow
  }
}

module.exports = logActivity;
