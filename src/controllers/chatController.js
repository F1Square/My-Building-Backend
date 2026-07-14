const supabase = require('../supabase');
const { userDisplayName, displayNameFromRaw } = require('../utils/userDisplayName');

const MAX_MESSAGE_LENGTH = 500;

function mapChatMessage(row) {
  if (!row) return row;
  return { ...row, sender_name: displayNameFromRaw(row.sender_name) };
}

// Send message
exports.sendMessage = async (req, res) => {
  const { message } = req.body;
  const { id: user_id } = req.user;
  const building_id = req.user.building_id || req.query.building_id || req.body.building_id;
  const senderName = userDisplayName(req.user);

  if (!building_id) return res.status(400).json({ error: 'You must be part of a building to chat' });

  const trimmed = message?.trim();
  if (!trimmed) return res.status(422).json({ error: 'Message cannot be empty' });
  if (trimmed.length > MAX_MESSAGE_LENGTH)
    return res.status(422).json({ error: `Message must not exceed ${MAX_MESSAGE_LENGTH} characters` });

  const { data, error } = await supabase
    .from('chats')
    .insert({ user_id, building_id, message: trimmed, sender_name: senderName })
    .select('id, user_id, building_id, message, sender_name, created_at')
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(mapChatMessage(data));
};

// Get paginated messages (page 1 = newest window; higher pages = older)
exports.getMessages = async (req, res) => {
  const building_id = req.user.building_id || req.query.building_id;
  if (!building_id) return res.status(400).json({ error: 'You must be part of a building to chat' });

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const { data, error } = await supabase
    .from('chats')
    .select('id, user_id, building_id, message, sender_name, created_at')
    .eq('building_id', building_id)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) return res.status(400).json({ error: error.message });
  res.json((data || []).reverse().map(mapChatMessage));
};

// Get only messages newer than a given message ID (for incremental polling)
exports.getNewMessages = async (req, res) => {
  const building_id = req.user.building_id || req.query.building_id;
  if (!building_id) return res.json([]);

  const { after_id } = req.query;

  let query = supabase
    .from('chats')
    .select('id, user_id, building_id, message, sender_name, created_at')
    .eq('building_id', building_id)
    .order('created_at', { ascending: true })
    .limit(50);

  if (after_id) {
    const { data: afterMsg } = await supabase
      .from('chats')
      .select('created_at')
      .eq('id', after_id)
      .maybeSingle();
    if (afterMsg?.created_at) {
      query = query.gt('created_at', afterMsg.created_at);
    }
  }

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json((data || []).map(mapChatMessage));
};
