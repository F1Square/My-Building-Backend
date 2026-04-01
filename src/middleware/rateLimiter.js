/**
 * Simple in-memory rate limiter (use redis-based in production)
 */
const store = new Map();

const rateLimiter = (maxRequests = 10, windowMs = 60_000) => (req, res, next) => {
  const key = req.ip;
  const now = Date.now();
  const entry = store.get(key) || { count: 0, start: now };

  if (now - entry.start > windowMs) {
    entry.count = 1;
    entry.start = now;
  } else {
    entry.count += 1;
  }

  store.set(key, entry);

  if (entry.count > maxRequests) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }
  next();
};

module.exports = rateLimiter;
