const express = require('express');
const { requireAuth } = require('../middleware/session');
const reminderService = require('../services/reminderService');

const router = express.Router();

router.get('/reminders-due', requireAuth, (req, res) => {
  res.json({ due: reminderService.getDueNow(req.user.id) });
});

module.exports = router;
