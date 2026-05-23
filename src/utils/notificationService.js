const supabase = require('../supabase');

let expoSdkPromise = null;

async function getExpoSdk() {
  if (!expoSdkPromise) {
    expoSdkPromise = import('expo-server-sdk')
      .then((mod) => {
        const Expo = mod.Expo || mod.default?.Expo;
        if (!Expo) {
          throw new Error('Failed to load Expo class from expo-server-sdk');
        }
        return { Expo, expo: new Expo() };
      })
      .catch((error) => {
        expoSdkPromise = null;
        throw error;
      });
  }
  return expoSdkPromise;
}

async function filterValidExpoMessages(recipients, mapMessage) {
  const recipientsWithToken = (recipients || []).filter((r) => r?.expo_push_token);
  if (!recipientsWithToken.length) return [];

  try {
    const { Expo } = await getExpoSdk();
    return recipientsWithToken
      .filter((r) => Expo.isExpoPushToken(r.expo_push_token))
      .map((r) => mapMessage(r.expo_push_token));
  } catch (error) {
    console.error('Error validating Expo push tokens:', error);
    return [];
  }
}

// Helper to send push notifications via Expo
async function sendPushNotifications(messages) {
  if (!messages?.length) return;

  try {
    const { expo } = await getExpoSdk();
    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      try {
        await expo.sendPushNotificationsAsync(chunk);
      } catch (error) {
        console.error('Error sending push notification chunk:', error);
      }
    }
  } catch (error) {
    console.error('Error initializing Expo SDK:', error);
  }
}

// Notify a single user
exports.notifyUser = async (user_id, { title, body, type, meta = {} }) => {
  // 1. Record in DB
  await supabase.from('notifications').insert({ user_id, title, body, type, meta });

  // 2. Send Push
  const { data: user } = await supabase.from('users').select('expo_push_token').eq('id', user_id).single();
  if (user?.expo_push_token) {
    const messages = await filterValidExpoMessages([user], (token) => ({
      to: token,
      sound: 'default',
      title,
      body,
      data: { type, ...meta },
    }));
    await sendPushNotifications(messages);
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
  const messages = await filterValidExpoMessages(members, (token) => ({
    to: token,
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
  const messages = await filterValidExpoMessages(pramukhs, (token) => ({
    to: token,
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
  const messages = await filterValidExpoMessages(members, (token) => ({
    to: token,
    sound: 'default',
    title,
    body,
    data: { type, ...meta },
  }));

  if (messages.length > 0) {
    await sendPushNotifications(messages);
  }
};
