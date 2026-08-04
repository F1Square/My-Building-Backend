const supabase = require('../supabase');
const { normalizeLang } = require('./notificationCopy');

/** Expo allows max 6 concurrent connections; keep sends within that. */
const EXPO_CHUNK_CONCURRENCY = 6;
/** Keep PostgREST payloads bounded for large buildings. */
const NOTIFICATION_INSERT_CHUNK = 500;

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

function buildPushMessagesSync(Expo, recipients, payload) {
  const tokenSeen = new Set();
  const messages = [];
  for (const r of recipients) {
    const token = r?.expo_push_token;
    if (!token || !Expo.isExpoPushToken(token) || tokenSeen.has(token)) continue;
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
}

async function sendPushChunks(expo, chunks) {
  for (let i = 0; i < chunks.length; i += EXPO_CHUNK_CONCURRENCY) {
    const batch = chunks.slice(i, i + EXPO_CHUNK_CONCURRENCY);
    await Promise.all(
      batch.map(async (chunk) => {
        try {
          await expo.sendPushNotificationsAsync(chunk);
        } catch (error) {
          console.error('Error sending push notification chunk:', error);
        }
      }),
    );
  }
}

async function insertNotificationRows(rows) {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += NOTIFICATION_INSERT_CHUNK) {
    const slice = rows.slice(i, i + NOTIFICATION_INSERT_CHUNK);
    const { error } = await supabase.from('notifications').insert(slice);
    if (error) throw error;
  }
}

/**
 * Inbox insert + Expo push for recipients that already include
 * { id, expo_push_token, app_language }. Skips an extra users query.
 */
async function deliverToRecipients(recipients, payload) {
  const uniqueMembers = dedupeRecipients(recipients);
  if (!uniqueMembers.length) return;

  const rows = uniqueMembers.map((m) => {
    const { title, body, type, meta } = resolveMessage(payload, m.app_language);
    return { user_id: m.id, title, body, type, meta };
  });

  await insertNotificationRows(rows);

  try {
    const { Expo, expo } = await getExpoSdk();
    const messages = dedupePushMessages(buildPushMessagesSync(Expo, uniqueMembers, payload));
    if (!messages.length) return;
    const chunks = expo.chunkPushNotifications(messages);
    await sendPushChunks(expo, chunks);
  } catch (error) {
    console.error('Error sending push notifications:', error);
  }
}

// Notify a single user (payload.build = (lang) => ({ title, body }) for localized text)
exports.notifyUser = async (user_id, payload) => {
  const { data: user } = await supabase
    .from('users')
    .select('id, expo_push_token, app_language')
    .eq('id', user_id)
    .single();

  if (!user) {
    const { title, body, type, meta } = resolveMessage(payload, null);
    await supabase.from('notifications').insert({ user_id, title, body, type, meta });
    return;
  }

  await deliverToRecipients([user], payload);
};

/** Prefer when caller already loaded user rows (avoids a second users query). */
exports.notifyRecipients = deliverToRecipients;

/** Batch notify many users (one users query + chunked insert/push). Prefer over looping notifyUser. */
exports.notifyUsersByIds = async (user_ids, payload) => {
  const ids = [...new Set((user_ids || []).filter(Boolean))];
  if (!ids.length) return;

  const { data: members } = await supabase
    .from('users')
    .select('id, expo_push_token, app_language')
    .in('id', ids);

  await deliverToRecipients(members, payload);
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
  await deliverToRecipients(members, payload);
};

exports.notifyPramukh = async (building_id, payload) => {
  const { data: pramukhs } = await supabase
    .from('users')
    .select('id, expo_push_token, app_language')
    .eq('building_id', building_id)
    .eq('role', 'pramukh')
    .eq('status', 'approved');

  await deliverToRecipients(pramukhs, payload);
};

exports.notifyMembersExcept = async (building_id, exclude_user_id, payload) => {
  return exports.notifyMembers(building_id, payload, null, exclude_user_id);
};

exports.resolveMessage = resolveMessage;
exports.normalizeLang = normalizeLang;
