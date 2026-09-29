const express = require('express');
const bcrypt = require('bcrypt');
const userStore = require('../services/userStore');
const asyncHandler = require('../middleware/asyncHandler');
const { setSessionCookie, clearSessionCookie } = require('../middleware/session');

const router = express.Router();
const SALT_ROUNDS = 10;

router.post('/signup', asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are all required.' });
  }
  if (userStore.findByEmail(email)) {
    return res.status(409).json({ error: 'An account with that email already exists. Please log in instead.' });
  }
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const user = userStore.createUser({ name, email, passwordHash });
  setSessionCookie(res, user.id);
  res.json({ id: user.id, name: user.name, email: user.email, isNewUser: true });
}));

router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  console.log(`[auth] login attempt - email: "${email}", password length: ${password ? password.length : 0}, cookie header present: ${!!req.headers.cookie}`);

  if (!email || !password) {
    console.log('[auth] login rejected - missing email or password');
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  const user = userStore.findByEmail(email);
  if (!user) {
    console.log(`[auth] login rejected - no account found for email "${email}"`);
    return res.status(401).json({ error: 'No account found with that email. Check the spelling, or sign up instead.' });
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    console.log(`[auth] login rejected - wrong password for "${email}"`);
    return res.status(401).json({ error: 'That password is incorrect for this email. Please try again.' });
  }
  setSessionCookie(res, user.id);
  console.log(`[auth] login SUCCESS for "${email}" (userId: ${user.id}) - session cookie set`);
  res.json({ id: user.id, name: user.name, email: user.email, isNewUser: false });
}));

router.post('/logout', (req, res) => {
  console.log('[auth] logout, userId was:', req.user ? req.user.id : '(none)');
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  console.log(`[auth] /api/me check - cookie header present: ${!!req.headers.cookie}, resolved user: ${req.user ? req.user.email : '(none - not logged in)'}`);
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  const { passwordHash, ...safe } = req.user;
  res.json(safe);
});

module.exports = router;
