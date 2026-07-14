const supabase = require('../supabase');
const { userDisplayName } = require('./userDisplayName');

/**
 * Insert a row into user_activity_logs. Fire-and-forget — never throws,
 * never blocks the request.
 *
 * The `level` field lives inside the `detail` JSON column so the schema
 * doesn't need to change. Admin UI / queries filter via
 * `detail->>level = 'error'`.
 *
 * @param {object} user   - req.user (id, name, role, building_id)
 * @param {string} action - short verb e.g. 'create_complaint', 'pay_bill'
 * @param {string} module - module name e.g. 'complaints', 'maintenance'
 * @param {object} detail - any extra context (ids, amounts, etc.)
 * @param {string} ip     - req.ip
 * @param {'info'|'error'} level - 'info' for normal activity, 'error' for technical failures
 */
async function logActivity(user, action, module, detail = {}, ip = null, level = 'info') {
  try {
    const enrichedDetail = { ...detail, level };
    await supabase.from('user_activity_logs').insert({
      user_id:     user?.id   || null,
      user_name:   user ? userDisplayName(user) : null,
      user_role:   user?.role || null,
      building_id: user?.building_id || null,
      action,
      module,
      detail:      enrichedDetail,
      ip_address:  ip,
    });
  } catch {
    // Logging must never break the main flow.
  }
}

/**
 * Convenience for technical errors. Prefixes the action with 'error_' so
 * even legacy queries that don't read detail.level still see something
 * marked as a problem.
 */
function logError(user, action, module, detail = {}, ip = null) {
  return logActivity(user, action, module, detail, ip, 'error');
}

module.exports = logActivity;
module.exports.logActivity = logActivity;
module.exports.logError = logError;
