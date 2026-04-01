const jwt = require('jsonwebtoken');

const verifyToken = (token) => jwt.verify(token, process.env.JWT_SECRET);

const authenticate = (req, res, next) => {
  // Support Bearer header OR ?token= query param (for PDF download links)
  const token = req.headers.authorization?.split(' ')[1] || req.query.token;
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    req.user = verifyToken(token);
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

module.exports = { authenticate, requireRole };
