const express = require('express');
const path = require('path');
const fs = require('fs');
const { requireAuth } = require('../middleware/session');
const { photoUpload } = require('../middleware/upload');
const userStore = require('../services/userStore');
const profileNarrativeService = require('../services/profileNarrativeService');
const medicationService = require('../services/medicationService');
const profileWizardService = require('../services/profileWizardService');
const { normalizeBirthday, parseMonthDay } = require('../services/dateUtil');
const config = require('../config');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const { passwordHash, ...safe } = req.user;
  res.json({
    ...safe,
    biography: profileNarrativeService.readNarrative(req.user.id)
  });
});

router.get('/medications', requireAuth, (req, res) => {
  res.json({ medications: medicationService.list(req.user.id) });
});

router.post('/medications', requireAuth, (req, res) => {
  const result = medicationService.add(req.user.id, req.body);
  if (!result.ok) return res.status(400).json({ error: 'Please type the medication name.' });
  res.json(result);
});

router.delete('/medications/:medId', requireAuth, (req, res) => {
  const result = medicationService.remove(req.user.id, { id: req.params.medId });
  if (!result.ok) return res.status(404).json({ error: 'Medication not found.' });
  res.json({ ok: true });
});

router.post('/family', requireAuth, async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 100);
  const relation = String(req.body.relation || '').trim().slice(0, 50);
  if (!name) return res.status(400).json({ error: 'Please type their name.' });

  let birthday = null;
  if (req.body.birthday) {
    birthday = normalizeBirthday(req.body.birthday);
    const parts = parseMonthDay(birthday);
    // Feb 29 is allowed (no year is needed to have one); other months can't exceed their length.
    const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (!parts || parts.day > daysInMonth[parts.month - 1]) {
      return res.status(400).json({ error: "That birthday isn't a real date. Please check the month and day." });
    }
  }

  // Same path the voice wizard uses: adds the person, and creates their yearly birthday reminder.
  await profileWizardService.saveField(req.user.id, 'family', [{ name, relation, birthday }]);
  res.json({ ok: true });
});

router.post('/family/:memberId/photo', requireAuth, photoUpload.single('photo'), (req, res) => {
  const member = req.user.profile.family.find((m) => m.id === req.params.memberId);
  if (!member) return res.status(404).json({ error: 'Family member not found.' });

  userStore.updateUser(req.user.id, (user) => {
    const target = user.profile.family.find((m) => m.id === req.params.memberId);
    target.photoFilename = req.file.filename;
  });
  res.json({ ok: true, photoFilename: req.file.filename });
});

router.get('/family/:memberId/photo', requireAuth, (req, res) => {
  const member = req.user.profile.family.find((m) => m.id === req.params.memberId);
  if (!member || !member.photoFilename) return res.status(404).end();
  const filePath = path.join(config.paths.uploadsDir, req.user.id, 'family', member.photoFilename);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.sendFile(filePath);
});

router.post('/reset', requireAuth, (req, res) => {
  const userId = req.user.id;
  userStore.resetUserData(userId);
  profileNarrativeService.deleteNarrative(userId);

  const uploadsDir = path.join(config.paths.uploadsDir, userId);
  if (fs.existsSync(uploadsDir)) fs.rmSync(uploadsDir, { recursive: true, force: true });

  res.json({ ok: true });
});

module.exports = router;
