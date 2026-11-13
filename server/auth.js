'use strict';

// Authentication helpers for Picante: bcrypt passwords, cookie sessions,
// auth middleware, and the 13+ age gate.

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const COOKIE_NAME = 'picante_session';
const SESSION_DAYS = 30;

function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  };
}

// Create a session row and set the session cookie on the response.
// Returns the token.
async function createSession(pool, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await pool.query(
    'INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)',
    [userId, token, expiresAt]
  );
  res.cookie(COOKIE_NAME, token, sessionCookieOptions());
  return token;
}

// Delete a session row (by token) and clear the cookie.
async function destroySession(pool, req, res) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (token) {
    await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
  }
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

// Look up the user for a session token. Returns the public user object
// ({id, username, displayName, bio}) or null. Never returns password_hash/dob.
async function userForToken(pool, token) {
  if (!token) return null;
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.display_name, u.bio
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token = $1 AND s.expires_at > NOW()`,
    [token]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return { id: r.id, username: r.username, displayName: r.display_name, bio: r.bio };
}

function requireAuth(pool) {
  return async (req, res, next) => {
    const token = req.cookies && req.cookies[COOKIE_NAME];
    const user = await userForToken(pool, token);
    if (!user) return res.status(401).json({ error: 'Not signed in.' });
    req.user = user;
    next();
  };
}

function optionalAuth(pool) {
  return async (req, res, next) => {
    const token = req.cookies && req.cookies[COOKIE_NAME];
    req.user = (await userForToken(pool, token)) || null;
    next();
  };
}

// Age gate: dobString must be a real calendar date in YYYY-MM-DD form
// (rejects impossible dates like 2020-02-30 and future dates) and the
// person must be 13 or older today. Returns an error message or null.
function validateDob(dobString) {
  if (typeof dobString !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dobString)) {
    return 'Please enter a valid date of birth (YYYY-MM-DD).';
  }
  const [y, m, d] = dobString.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return 'Please enter a valid date of birth.';
  }
  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (date > todayUTC) {
    return 'Date of birth cannot be in the future.';
  }
  let age = todayUTC.getUTCFullYear() - y;
  const monthDiff = todayUTC.getUTCMonth() - (m - 1);
  if (monthDiff < 0 || (monthDiff === 0 && todayUTC.getUTCDate() < d)) age -= 1;
  if (age < 13) {
    return 'You must be at least 13 years old to join Picante.';
  }
  return null;
}

module.exports = {
  COOKIE_NAME,
  hashPassword,
  comparePassword,
  createSession,
  destroySession,
  userForToken,
  requireAuth,
  optionalAuth,
  validateDob,
};
