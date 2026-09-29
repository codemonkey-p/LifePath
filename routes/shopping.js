const express = require('express');
const { requireAuth } = require('../middleware/session');
const asyncHandler = require('../middleware/asyncHandler');
const shoppingService = require('../services/shoppingService');
const ttsService = require('../services/ttsService');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  res.json(shoppingService.getList(req.user.id));
});

router.post('/items', requireAuth, (req, res) => {
  const { item, placeId } = req.body;
  if (!item || !String(item).trim()) return res.status(400).json({ error: 'Please type what you need to buy.' });
  const created = shoppingService.addItem(req.user.id, { item: String(item), placeId: placeId || null });
  res.json({ ok: true, item: created });
});

router.patch('/items/:id', requireAuth, (req, res) => {
  const updated = shoppingService.setDone(req.user.id, req.params.id, !!req.body.done);
  if (!updated) return res.status(404).json({ error: 'Item not found.' });
  res.json({ ok: true, item: updated });
});

router.delete('/items/:id', requireAuth, (req, res) => {
  shoppingService.removeItem(req.user.id, req.params.id);
  res.json({ ok: true });
});

router.post('/places', requireAuth, (req, res) => {
  const place = shoppingService.addPlace(req.user.id, req.body.name);
  if (!place) return res.status(400).json({ error: 'Please type the name of the store.' });
  res.json({ ok: true, place });
});

router.put('/places/:id/location', requireAuth, (req, res) => {
  const lat = Number(req.body.lat);
  const lng = Number(req.body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ error: 'That location is not valid.' });
  }
  const place = shoppingService.setPlaceLocation(req.user.id, req.params.id, lat, lng);
  if (!place) return res.status(404).json({ error: 'Store not found.' });
  res.json({ ok: true, place });
});

router.delete('/places/:id', requireAuth, (req, res) => {
  shoppingService.removePlace(req.user.id, req.params.id);
  res.json({ ok: true });
});

// Called when the phone arrives at (or the person previews) a store. The message is built
// here from the saved list rather than taken from the client, so this can't be used to
// read arbitrary text aloud.
router.post('/places/:id/arrive', requireAuth, asyncHandler(async (req, res) => {
  const place = shoppingService.getPlaces(req.user.id).find((p) => p.id === req.params.id);
  if (!place) return res.status(404).json({ error: 'Store not found.' });
  const items = shoppingService.openItemsForPlace(req.user.id, place.id);
  const text = shoppingService.buildArrivalMessage(place.name, items);
  if (!text) return res.json({ placeName: place.name, items: [], text: '' });
  const audio = await ttsService.synthesizeSpeech(text);
  res.json({ placeName: place.name, items, text, audioBase64: audio.toString('base64') });
}));

module.exports = router;
