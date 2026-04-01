const supabase = require('../supabase');

const MAX_MESSAGE_LENGTH = 500;

// Send message
exports.sendMessage = async (req, res) => {
  const { message } = req.body;
  const { id: user_id, name } = req.user;
  const building_id = req.user.building_id || req.query.building_id || req.body.building_id;

  if (!building_id) return res.status(400).json({ error: 'You must be part of a building to chat' });

  const trimmed = message?.trim();
  if (!trimmed) return res.status(422).json({ error: 'Message cannot be empty' });
  if (trimmed.length > MAX_MESSAGE_LENGTH)
    return res.status(422).json({ error: `Message must not exceed ${MAX_MESSAGE_LENGTH} characters` });

  const { data, error } = await supabase
    .from('chats')
    .insert({ user_id, building_id, message: trimmed, sender_name: name })
    .select().single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
};

// Get only messages newer than a given message ID (for incremental polling)
exports.getNewMessages = async (req, res) => {
  const building_id = req.user.building_id || req.query.building_id;
  if (!building_id) return res.json([]);

  const { after_id } = req.query;

  let query = supabase
    .from('chats')
    .select('*')
    .eq('building_id', building_id)
    .order('created_at', { ascending: true })
    .limit(50);

  // If after_id provided, get the created_at of that message and fetch newer ones
  if (after_id) {
    const { data: ref } = await supabase
      .from('chats').select('created_at').eq('id', after_id).single();
    if (ref) {
      query = query.gt('created_at', ref.created_at);
    }
  }

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
};

// Get messages for building (paginated)
exports.getMessages = async (req, res) => {
  const building_id = req.user.building_id || req.query.building_id;

  // Admin with no building_id: return empty (they need to pick a building)
  if (!building_id) {
    if (req.user.role === 'admin') return res.json([]);
    return res.status(400).json({ error: 'You must be part of a building' });
  }

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 50);
  const from = (page - 1) * limit;

  const { data, error } = await supabase
    .from('chats')
    .select('*')
    .eq('building_id', building_id)
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1);

  if (error) return res.status(400).json({ error: error.message });
  res.json(data.reverse());
};
