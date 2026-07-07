const supabase = require('../supabase');
const ns = require('../utils/notificationService');

const VALID_STATUS = ['open', 'in_progress', 'resolved', 'closed'];

async function notifyAdmins({ title, body, meta }) {
  const { data: admins } = await supabase.from('users').select('id').eq('role', 'admin');
  for (const admin of admins || []) {
    await ns.notifyUser(admin.id, { title, body, type: 'support', meta });
  }
}

async function getTicketForUser(ticketId, user) {
  const { data: ticket, error } = await supabase
    .from('support_tickets')
    .select('*, users(name, email, flat_no, wing), buildings(name)')
    .eq('id', ticketId)
    .single();

  if (error || !ticket) return { error: 'Ticket not found', status: 404 };

  if (user.role === 'admin') return { ticket };
  if (ticket.user_id !== user.id) return { error: 'Access denied', status: 403 };

  return { ticket };
}

async function getMessages(ticketId) {
  const { data, error } = await supabase
    .from('support_ticket_messages')
    .select('*')
    .eq('ticket_id', ticketId)
    .eq('is_internal', false)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

// POST /support-tickets — user/pramukh create
exports.createTicket = async (req, res) => {
  const { subject, message, category } = req.body;
  if (!subject?.trim()) return res.status(422).json({ error: 'Subject is required' });
  if (!message?.trim()) return res.status(422).json({ error: 'Message is required' });

  const now = new Date().toISOString();
  const { data: ticket, error } = await supabase
    .from('support_tickets')
    .insert({
      user_id: req.user.id,
      building_id: req.user.building_id || null,
      subject: subject.trim(),
      description: message.trim(),
      category: category?.trim() || 'General',
      created_by_role: req.user.role,
      status: 'open',
      last_message_at: now,
      updated_at: now,
    })
    .select('*')
    .single();

  if (error) return res.status(400).json({ error: error.message });

  const { error: msgErr } = await supabase.from('support_ticket_messages').insert({
    ticket_id: ticket.id,
    sender_id: req.user.id,
    sender_name: req.user.name,
    sender_role: req.user.role,
    message: message.trim(),
  });
  if (msgErr) {
    await supabase.from('support_tickets').delete().eq('id', ticket.id);
    return res.status(400).json({ error: msgErr.message });
  }

  await notifyAdmins({
    title: 'New Help & Support ticket',
    body: `${req.user.name}: ${subject.trim()}`,
    meta: { ticket_id: ticket.id },
  });

  res.status(201).json({ message: 'Support ticket created', ticket });
};

// GET /support-tickets/my — user/pramukh own tickets
exports.getMyTickets = async (req, res) => {
  const { status } = req.query;
  let query = supabase
    .from('support_tickets')
    .select('id, subject, category, status, last_message_at, created_at, updated_at')
    .eq('user_id', req.user.id)
    .order('last_message_at', { ascending: false, nullsFirst: false });

  if (status && status !== 'all') query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};

// GET /support-tickets/admin — admin all tickets
exports.adminGetTickets = async (req, res) => {
  const { status, search } = req.query;
  let query = supabase
    .from('support_tickets')
    .select('*, users(name, email, flat_no, wing), buildings(name)')
    .order('last_message_at', { ascending: false, nullsFirst: false });

  if (status && status !== 'all') query = query.eq('status', status);
  if (search?.trim()) {
    const term = `%${search.trim()}%`;
    query = query.or(`subject.ilike.${term},description.ilike.${term}`);
  }

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};

// GET /support-tickets/:id — ticket + messages
exports.getTicketById = async (req, res) => {
  const { id } = req.params;
  const result = await getTicketForUser(id, req.user);
  if (result.error) return res.status(result.status).json({ error: result.error });

  try {
    const messages = await getMessages(id);
    res.json({ ticket: result.ticket, messages });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// POST /support-tickets/:id/messages — reply
exports.addMessage = async (req, res) => {
  const { id } = req.params;
  const { message } = req.body;
  if (!message?.trim()) return res.status(422).json({ error: 'Message is required' });

  const result = await getTicketForUser(id, req.user);
  if (result.error) return res.status(result.status).json({ error: result.error });

  const ticket = result.ticket;
  if (ticket.status === 'closed') {
    return res.status(400).json({ error: 'This ticket is closed' });
  }

  const now = new Date().toISOString();
  const isAdmin = req.user.role === 'admin';

  const { data: msg, error } = await supabase
    .from('support_ticket_messages')
    .insert({
      ticket_id: id,
      sender_id: req.user.id,
      sender_name: req.user.name,
      sender_role: req.user.role,
      message: message.trim(),
    })
    .select('*')
    .single();

  if (error) return res.status(400).json({ error: error.message });

  const nextStatus = isAdmin
    ? (ticket.status === 'open' ? 'in_progress' : ticket.status)
    : (ticket.status === 'resolved' ? 'open' : ticket.status);

  await supabase
    .from('support_tickets')
    .update({ last_message_at: now, updated_at: now, status: nextStatus })
    .eq('id', id);

  if (isAdmin && ticket.user_id) {
    await ns.notifyUser(ticket.user_id, {
      title: 'Support reply received',
      body: `Admin replied to: ${ticket.subject}`,
      type: 'support',
      meta: { ticket_id: id },
    });
  } else if (!isAdmin) {
    await notifyAdmins({
      title: 'Support ticket updated',
      body: `${req.user.name} replied on: ${ticket.subject}`,
      meta: { ticket_id: id },
    });
  }

  res.status(201).json({ message: 'Reply sent', reply: msg });
};

// PATCH /support-tickets/:id/status — admin update status
exports.updateStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!VALID_STATUS.includes(status)) {
    return res.status(422).json({ error: 'Invalid status' });
  }

  const { data: ticket, error: fetchErr } = await supabase
    .from('support_tickets')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchErr || !ticket) return res.status(404).json({ error: 'Ticket not found' });

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('support_tickets')
    .update({ status, updated_at: now })
    .eq('id', id)
    .select('*')
    .single();

  if (error) return res.status(400).json({ error: error.message });

  if (ticket.user_id && status !== ticket.status) {
    const label = status.replace(/_/g, ' ');
    await ns.notifyUser(ticket.user_id, {
      title: 'Support ticket updated',
      body: `Your ticket "${ticket.subject}" is now ${label}`,
      type: 'support',
      meta: { ticket_id: id, status },
    });
  }

  res.json({ message: 'Status updated', ticket: data });
};
