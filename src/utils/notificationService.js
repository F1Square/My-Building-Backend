const supabase = require('../supabase');
const { Expo } = require('expo-server-sdk');

const expo = new Expo();

// Helper to send push notifications via Expo
async function sendPushNotifications(messages) {
  const chunks = expo.chunkPushNotifications(messages);
  const tickets = [];
  for (const chunk of chunks) {
    try {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...ticketChunk);
    } catch (error) {
      console.error('Error sending push notification chunk:', error);
    }
  }
}

// Notify a single user
exports.notifyUser = async (user_id, { title, body, type, meta = {} }) => {
  // 1. Record in DB
  await supabase.from('notifications').insert({ user_id, title, body, type, meta });

  // 2. Send Push
  const { data: user } = await supabase.from('users').select('expo_push_token').eq('id', user_id).single();
  if (user?.expo_push_token && Expo.isExpoPushToken(user.expo_push_token)) {
    await sendPushNotifications([{
      to: user.expo_push_token,
      sound: 'default',
      title,
      body,
      data: { type, ...meta },
    }]);
  }
};

// Notify a list of members or all approved members of a building
exports.notifyMembers = async (building_id, { title, body, type, meta = {} }, specific_user_ids = null) => {
  let query = supabase.from('users').select('id, expo_push_token').eq('building_id', building_id).eq('status', 'approved');
  
  if (specific_user_ids && Array.isArray(specific_user_ids)) {
    query = query.in('id', specific_user_ids);
  }

  const { data: members } = await query;
  if (!members?.length) return;

  // 1. Record in DB
  await supabase.from('notifications').insert(
    members.map((m) => ({ user_id: m.id, title, body, type, meta }))
  );

  // 2. Send Push
  const messages = members
    .filter(m => m.expo_push_token && Expo.isExpoPushToken(m.expo_push_token))
    .map(m => ({
      to: m.expo_push_token,
      sound: 'default',
      title,
      body,
      data: { type, ...meta },
    }));

  if (messages.length > 0) {
    await sendPushNotifications(messages);
  }
};

// Notify the pramukh of a building
exports.notifyPramukh = async (building_id, { title, body, type, meta = {} }) => {
  const { data: pramukhs } = await supabase
    .from('users')
    .select('id, expo_push_token')
    .eq('building_id', building_id)
    .eq('role', 'pramukh')
    .eq('status', 'approved');

  if (!pramukhs?.length) return;

  // 1. Record in DB
  await supabase.from('notifications').insert(
    pramukhs.map(p => ({ user_id: p.id, title, body, type, meta }))
  );

  // 2. Send Push
  const messages = pramukhs
    .filter(p => p.expo_push_token && Expo.isExpoPushToken(p.expo_push_token))
    .map(p => ({
      to: p.expo_push_token,
      sound: 'default',
      title,
      body,
      data: { type, ...meta },
    }));

  if (messages.length > 0) {
    await sendPushNotifications(messages);
  }
};

// Notify members excluding a specific user (e.g. the sender)
exports.notifyMembersExcept = async (building_id, exclude_user_id, { title, body, type, meta = {} }) => {
  const { data: members } = await supabase
    .from('users')
    .select('id, expo_push_token')
    .eq('building_id', building_id)
    .eq('status', 'approved')
    .neq('id', exclude_user_id);

  if (!members?.length) return;

  // 1. Record in DB
  await supabase.from('notifications').insert(
    members.map((m) => ({ user_id: m.id, title, body, type, meta }))
  );

  // 2. Send Push
  const messages = members
    .filter(m => m.expo_push_token && Expo.isExpoPushToken(m.expo_push_token))
    .map(m => ({
      to: m.expo_push_token,
      sound: 'default',
      title,
      body,
      data: { type, ...meta },
    }));

  if (messages.length > 0) {
    await sendPushNotifications(messages);
  }
};
