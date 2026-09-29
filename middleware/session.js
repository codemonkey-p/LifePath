const userStore = require('../services/userStore');

const COOKIE_NAME = 'lifepath_session';

function setSessionCookie(res, userId) {
  res.cookie(COOKIE_NAME, userId, {
    httpOnly: true,
    signed: true,
    // The Electron demo loads the app inside an <iframe> whose parent document is file://,
    // a different "site" than http://localhost. SameSite=Lax cookies are never sent from
    // inside a cross-site iframe, so login would silently fail there. SameSite=None fixes
    // this and requires Secure - which Chromium allows over plain HTTP specifically for
    // localhost (treated as a secure context), so this works both in the iframe demo and
    // in a normal browser tab.
    sameSite: 'none',
    secure: true,
    maxAge: 1000 * 60 * 60 * 24 * 90
  });
}

function clearSessionCookie(res) {
  // Attributes must match setSessionCookie, or the browser ignores the deletion when the
  // app runs inside a cross-site iframe (a Set-Cookie without SameSite=None is rejected there).
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    signed: true,
    sameSite: 'none',
    secure: true,
    path: '/'
  });
}

function loadUser(req, res, next) {
  const userId = req.signedCookies[COOKIE_NAME];
  if (userId) {
    req.user = userStore.findById(userId) || null;
  } else {
    req.user = null;
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  next();
}

module.exports = { COOKIE_NAME, setSessionCookie, clearSessionCookie, loadUser, requireAuth };
