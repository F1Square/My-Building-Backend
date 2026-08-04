const supabase = require('../supabase');
const { isValidPhone } = require('../utils/validators');
const { notifyOpsWebsiteContact } = require('../utils/mailService');

// PUBLIC: website visitor submits contact form
exports.submitContact = async (req, res) => {
  const { name, email, phone, subject, message } = req.body;

  if (!name?.trim()) return res.status(422).json({ error: 'Name is required' });
  if (!email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
    return res.status(422).json({ error: 'Valid email is required' });
  const mobile = String(phone || '').replace(/\D/g, '').slice(0, 10);
  if (!mobile) return res.status(422).json({ error: 'Mobile number is required' });
  if (!isValidPhone(mobile)) {
    return res.status(422).json({ error: 'Enter a valid 10-digit Indian mobile number' });
  }
  if (!subject?.trim()) return res.status(422).json({ error: 'Subject is required' });
  if (!message?.trim()) return res.status(422).json({ error: 'Message is required' });
  if (message.trim().length > 2000) return res.status(422).json({ error: 'Message must not exceed 2000 characters' });

  const { data, error } = await supabase
    .from('website_contacts')
    .insert({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: mobile,
      subject: subject.trim(),
      message: message.trim(),
      status: 'new',
    })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  // Best-effort ops email — do not fail the contact if mail fails
  await notifyOpsWebsiteContact(data);

  res.status(201).json({ message: 'Message received. We will get back to you soon!', contact: data });
};

// ADMIN: get all website contacts
exports.getContacts = async (req, res) => {
  const { status } = req.query;
  let query = supabase
    .from('website_contacts')
    .select('*')
    .order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
};

// ADMIN: update status (new → read → replied)
exports.updateContactStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const VALID = ['new', 'read', 'replied'];
  if (!VALID.includes(status)) return res.status(422).json({ error: 'Invalid status' });

  const { data, error } = await supabase
    .from('website_contacts')
    .update({ status })
    .eq('id', id)
    .select()
    .single();

  if (error || !data) return res.status(404).json({ error: 'Contact not found' });
  res.json({ message: 'Status updated', contact: data });
};
