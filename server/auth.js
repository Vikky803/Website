const crypto = require('crypto');
const jwt = require('jsonwebtoken');

/**
 * Verifies a plaintext password against a stored "salt:hash" PBKDF2 value.
 * Uses a constant-time comparison to avoid timing attacks.
 */
function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  try {
    const check = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    const hashBuf = Buffer.from(hash, 'hex');
    const checkBuf = Buffer.from(check, 'hex');
    if (hashBuf.length !== checkBuf.length) return false;
    return crypto.timingSafeEqual(hashBuf, checkBuf);
  } catch {
    return false;
  }
}

function buildSeats(env) {
  return [
    { seat: 1, hash: env.SEAT_1_HASH },
    { seat: 2, hash: env.SEAT_2_HASH },
    { seat: 3, hash: env.SEAT_3_HASH },
  ].filter((s) => !!s.hash);
}

/** Checks a submitted password against all configured seats, returns the matching seat number or null. */
function checkLogin(password, env) {
  const seats = buildSeats(env);
  for (const s of seats) {
    if (verifyPassword(password, s.hash)) return s.seat;
  }
  return null;
}

function issueToken(seat, secret) {
  return jwt.sign({ seat }, secret, { expiresIn: '12h' });
}

function verifyToken(token, secret) {
  try {
    return jwt.verify(token, secret);
  } catch {
    return null;
  }
}

/** Express middleware — requires a valid Bearer token, attaches req.seat. */
function requireAuth(secret) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing authorization token.' });

    const payload = verifyToken(token, secret);
    if (!payload) return res.status(401).json({ error: 'Invalid or expired session.' });

    req.seat = payload.seat;
    next();
  };
}

module.exports = { verifyPassword, checkLogin, issueToken, verifyToken, requireAuth };
