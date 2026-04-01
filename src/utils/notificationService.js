const supabase = require('../supabase');

// Notify a single user
exports.notifyUser = async (user_id, { title, body, type, meta = {} }) => {
  await supabase.from('notifications').insert({ user_id, title, body, type, meta });
};

// Notify all approved members of a building
exports.notifyMembers = async (building_id, { title, body, type, meta = {} }) => {
  const { data: members } = await supabase
    .from('users')
    .select('id')
    .eq('building_id', building_id)
    .eq('status', 'approved');

  if (!members?.length) return;
  await supabase.from('notifications').insert(
    members.map((m) => ({ user_id: m.id, title, body, type, meta }))
  );
};

// Notify the pramukh of a building
exports.notifyPramukh = async (building_id, { title, body, type, meta = {} }) => {
  const { data: pramukh } = await supabase
    .from('users')
    .select('id')
    .eq('building_id', building_id)
    .eq('role', 'pramukh')
    .single();

  if (!pramukh) return;
  await supabase.from('notifications').insert({ user_id: pramukh.id, title, body, type, meta });
};

// Notify members excluding a specific user (e.g. the sender)
exports.notifyMembersExcept = async (building_id, exclude_user_id, { title, body, type, meta = {} }) => {
  const { data: members } = await supabase
    .from('users')
    .select('id')
    .eq('building_id', building_id)
    .eq('status', 'approved')
    .neq('id', exclude_user_id);

  if (!members?.length) return;
  await supabase.from('notifications').insert(
    members.map((m) => ({ user_id: m.id, title, body, type, meta }))
  );
};
