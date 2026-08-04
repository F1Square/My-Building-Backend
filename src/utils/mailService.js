const nodemailer = require('nodemailer');

/** Ops inbox for new society registrations & website inquiries. */
const DEFAULT_OPS_EMAIL = 'matechnology02@gmail.com';

let transporter = null;

function getMailer() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
    });
  }
  return transporter;
}

function opsNotifyEmail() {
  return (
    process.env.OPS_NOTIFY_EMAIL?.trim() ||
    process.env.ADMIN_EMAIL?.trim() ||
    DEFAULT_OPS_EMAIL
  );
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Send an email via the shared Gmail transport (MAIL_USER / MAIL_PASS).
 * Throws on SMTP failure so callers can decide whether to fail the request.
 */
async function sendMail({ to, subject, html, text }) {
  if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
    throw new Error('MAIL_USER / MAIL_PASS not configured');
  }
  const mailer = getMailer();
  return mailer.sendMail({
    from: `"My Building App" <${process.env.MAIL_USER}>`,
    to,
    subject,
    html,
    text,
  });
}

/**
 * Best-effort ops alert. Never throws — callers should not fail user flows on mail errors.
 */
async function notifyOps({ subject, html, text }) {
  try {
    await sendMail({
      to: opsNotifyEmail(),
      subject,
      html,
      text,
    });
  } catch (err) {
    console.error('[mail] ops notify failed:', err.message || err);
  }
}

function rowsHtml(rows) {
  return rows
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#6B7280;vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td><td style="padding:6px 0;color:#111827">${escapeHtml(value)}</td></tr>`,
    )
    .join('');
}

/** Society / building registration (app or website). */
async function notifyOpsSocietyInquiry(inquiry, source) {
  const society = inquiry?.society_name || 'Unknown society';
  const subject = `[My Building] New society registration — ${society}`;
  const rows = [
    ['Source', source],
    ['Society', inquiry?.society_name],
    ['Type', inquiry?.society_type],
    ['Contact name', inquiry?.user_name],
    ['Contact email', inquiry?.user_email],
    ['City', inquiry?.city],
    ['State', inquiry?.state],
    ['Pincode', inquiry?.pincode],
    ['Wings', inquiry?.total_wings],
    ['Address', inquiry?.address],
    ['Inquiry id', inquiry?.id],
  ];
  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:auto;padding:24px;background:#f5f7fa;border-radius:12px">
      <h2 style="color:#1E3A8A;margin:0 0 8px">New society registration</h2>
      <p style="color:#374151;margin:0 0 16px">A building registration was submitted and needs review.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">${rowsHtml(rows)}</table>
    </div>
  `;
  const text = rows
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  await notifyOps({ subject, html, text });
}

/** Website landing contact form. */
async function notifyOpsWebsiteContact(contact) {
  const subject = `[My Building] Website inquiry — ${contact?.subject || 'Contact'}`;
  const rows = [
    ['Name', contact?.name],
    ['Email', contact?.email],
    ['Subject', contact?.subject],
    ['Message', contact?.message],
    ['Contact id', contact?.id],
  ];
  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:auto;padding:24px;background:#f5f7fa;border-radius:12px">
      <h2 style="color:#1E3A8A;margin:0 0 8px">New website inquiry</h2>
      <p style="color:#374151;margin:0 0 16px">Someone submitted the contact form on the website.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">${rowsHtml(rows)}</table>
    </div>
  `;
  const text = rows
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  await notifyOps({ subject, html, text });
}

module.exports = {
  getMailer,
  sendMail,
  notifyOps,
  notifyOpsSocietyInquiry,
  notifyOpsWebsiteContact,
  opsNotifyEmail,
  escapeHtml,
};
