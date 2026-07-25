const jwt = require('jsonwebtoken');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const verifyToken = (token) => jwt.verify(token, process.env.JWT_SECRET);

/** Real users table ids are UUIDs; env-based fixed-login ids are not. */
function isDbUserId(id) {
  return typeof id === 'string' && UUID_RE.test(id);
}

/** JWT claim vs DB column — treat missing values as 0 for pre-migration tokens. */
function isTokenVersionValid(tokenVersion, currentVersion) {
  return Number(tokenVersion ?? 0) === Number(currentVersion ?? 0);
}

function nextTokenVersion(currentVersion) {
  return Number(currentVersion ?? 0) + 1;
}

const authenticate = async (req, res, next) => {
  // Support Bearer header OR ?token= query param (for PDF download links)
  const token = req.headers.authorization?.split(' ')[1] || req.query.token;
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const payload = verifyToken(token);

    // Password-reset session revocation for DB-backed accounts only.
    if (isDbUserId(payload.id)) {
      const supabase = require('../supabase');
      const { data, error } = await supabase
        .from('users')
        .select('token_version')
        .eq('id', payload.id)
        .maybeSingle();

      if (error || !data) {
        return res.status(401).json({ error: 'Invalid token' });
      }
      if (!isTokenVersionValid(payload.tv, data.token_version)) {
        return res.status(401).json({ error: 'Session expired. Please log in again.' });
      }
    }

    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    console.log(`[requireRole] denied — user role: "${req.user.role}", required: [${roles.join(', ')}]`);
    return res.status(403).json({ error: 'Access denied' });
  }
  next();
};

module.exports = {
  authenticate,
  requireRole,
  isDbUserId,
  isTokenVersionValid,
  nextTokenVersion,
};
