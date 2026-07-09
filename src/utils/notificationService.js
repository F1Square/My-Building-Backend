const supabase = require('../supabase');
const { normalizeLang } = require('./notificationCopy');

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

function dedupeRecipients(recipients) {
  const map = new Map();
  for (const r of recipients || []) {
    if (r?.id && !map.has(r.id)) map.set(r.id, r);
  }
  return [...map.values()];
}

function dedupePushMessages(messages) {
  const seen = new Set();
  const out = [];
  for (const m of messages || []) {
    if (!m?.to || seen.has(m.to)) continue;
    seen.add(m.to);
    out.push(m);
  }
  return out;
}

function resolveMessage(payload, lang) {
  const type = payload.type;
  const meta = payload.meta || {};
  if (typeof payload.build === 'function') {
    const { title, body } = payload.build(normalizeLang(lang));
    return { title, body, type, meta };
  }
  return {
    title: payload.title,
    body: payload.body,
    type,
    meta,
  };
}

async function buildPushMessages(recipients, payload) {
  const recipientsWithToken = dedupeRecipients(recipients).filter((r) => r?.expo_push_token);
  if (!recipientsWithToken.length) return [];

  try {
    const { Expo } = await getExpoSdk();
    const tokenSeen = new Set();
    const messages = [];
    for (const r of recipientsWithToken) {
      const token = r.expo_push_token;
      if (!Expo.isExpoPushToken(token) || tokenSeen.has(token)) continue;
      tokenSeen.add(token);
      const { title, body, type, meta } = resolveMessage(payload, r.app_language);
      messages.push({
        to: token,
        sound: 'default',
        title,
        body,
        data: { type, ...meta },
      });
    }
    return messages;
  } catch (error) {
    console.error('Error validating Expo push tokens:', error);
    return [];
  }
}

async function sendPushNotifications(messages) {
  const deduped = dedupePushMessages(messages);
  if (!deduped.length) return;

  try {
    const { expo } = await getExpoSdk();
    const chunks = expo.chunkPushNotifications(deduped);
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

// Notify a single user (payload.build = (lang) => ({ title, body }) for localized text)
exports.notifyUser = async (user_id, payload) => {
  const { data: user } = await supabase
    .from('users')
    .select('expo_push_token, app_language')
    .eq('id', user_id)
    .single();

  const { title, body, type, meta } = resolveMessage(payload, user?.app_language);

  await supabase.from('notifications').insert({ user_id, title, body, type, meta });

  if (user?.expo_push_token) {
    const messages = await buildPushMessages([user], payload);
    await sendPushNotifications(messages);
  }
};

// Notify members — each user gets title/body in their app_language
exports.notifyMembers = async (building_id, payload, specific_user_ids = null, exclude_user_id = null) => {
  let query = supabase
    .from('users')
    .select('id, expo_push_token, app_language')
    .eq('building_id', building_id)
    .eq('status', 'approved');

  if (specific_user_ids && Array.isArray(specific_user_ids)) {
    query = query.in('id', specific_user_ids);
  }
  if (exclude_user_id) {
    query = query.neq('id', exclude_user_id);
  }

  const { data: members } = await query;
  const uniqueMembers = dedupeRecipients(members);
  if (!uniqueMembers.length) return;

  const rows = uniqueMembers.map((m) => {
    const { title, body, type, meta } = resolveMessage(payload, m.app_language);
    return { user_id: m.id, title, body, type, meta };
  });

  await supabase.from('notifications').insert(rows);

  const messages = await buildPushMessages(uniqueMembers, payload);
  await sendPushNotifications(messages);
};

exports.notifyPramukh = async (building_id, payload) => {
  const { data: pramukhs } = await supabase
    .from('users')
    .select('id, expo_push_token, app_language')
    .eq('building_id', building_id)
    .eq('role', 'pramukh')
    .eq('status', 'approved');

  const uniquePramukhs = dedupeRecipients(pramukhs);
  if (!uniquePramukhs.length) return;

  const rows = uniquePramukhs.map((p) => {
    const { title, body, type, meta } = resolveMessage(payload, p.app_language);
    return { user_id: p.id, title, body, type, meta };
  });

  await supabase.from('notifications').insert(rows);

  const messages = await buildPushMessages(uniquePramukhs, payload);
  await sendPushNotifications(messages);
};

exports.notifyMembersExcept = async (building_id, exclude_user_id, payload) => {
  return exports.notifyMembers(building_id, payload, null, exclude_user_id);
};

exports.resolveMessage = resolveMessage;
exports.normalizeLang = normalizeLang;
