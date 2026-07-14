const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function looksLikeEmail(value) {
  return EMAIL_RE.test(String(value || '').trim());
}

function formatNameFromEmail(email, fallback = 'Resident') {
  const local = String(email || '').split('@')[0]?.trim();
  if (!local) return fallback;
  const words = local
    .replace(/[._+-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  return words.join(' ') || fallback;
}

/** Prefer a real name; never surface a raw email when a friendlier label exists. */
function userDisplayName(user, fallback = 'Resident') {
  if (!user) return fallback;

  const name = String(user.name || '').trim();
  const email = String(user.email || '').trim();
  const nameLower = name.toLowerCase();
  const emailLower = email.toLowerCase();

  if (name && nameLower !== emailLower && !looksLikeEmail(name)) {
    return name;
  }

  if (email && looksLikeEmail(email)) {
    return formatNameFromEmail(email, fallback);
  }

  if (name && !looksLikeEmail(name)) return name;
  return fallback;
}

/** Normalize a stored string that may be an email used as a "name". */
function displayNameFromRaw(raw, fallback = 'Resident') {
  return userDisplayName({ name: raw, email: raw }, fallback);
}

function withDisplayUser(user) {
  if (!user) return user;
  return { ...user, name: userDisplayName(user) };
}

/**
 * Map list rows that embed user objects (default key: users).
 * Example: mapRowsWithDisplayUsers(data) or mapRowsWithDisplayUsers(data, ['users', 'referrer'])
 */
function mapRowsWithDisplayUsers(rows, userKeys = ['users']) {
  if (!Array.isArray(rows)) return rows;
  const keys = Array.isArray(userKeys) ? userKeys : [userKeys];
  return rows.map((row) => {
    if (!row) return row;
    const next = { ...row };
    for (const key of keys) {
      if (next[key]) next[key] = withDisplayUser(next[key]);
    }
    return next;
  });
}

function mapComplaint(complaint) {
  if (!complaint) return complaint;
  return {
    ...complaint,
    users: complaint.users ? withDisplayUser(complaint.users) : complaint.users,
  };
}

function mapComplaints(complaints) {
  return Array.isArray(complaints) ? complaints.map(mapComplaint) : complaints;
}

module.exports = {
  userDisplayName,
  displayNameFromRaw,
  withDisplayUser,
  mapRowsWithDisplayUsers,
  mapComplaint,
  mapComplaints,
};
