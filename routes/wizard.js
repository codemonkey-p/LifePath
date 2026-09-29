const express = require('express');
const profileWizardService = require('../services/profileWizardService');
const userStore = require('../services/userStore');
const { requireAuth } = require('../middleware/session');

const router = express.Router();

router.post('/first-login-complete', requireAuth, (req, res) => {
  userStore.markFirstLoginCompleted(req.user.id);
  res.json({ ok: true });
});

router.get('/status', requireAuth, (req, res) => {
  const missing = profileWizardService.getMissingFields(req.user.profile);
  res.json({
    complete: missing.length === 0,
    missingFields: missing.map((f) => f.key),
    wizardSessionsCompleted: req.user.profile.wizardSessionsCompleted,
    // Anything recorded at all means they've already started, so the button says "more".
    hasStarted: profileWizardService.hasStarted(req.user.profile)
  });
});

module.exports = router;
