const { v4: uuidv4 } = require('uuid');
const userStore = require('./userStore');

function norm(text) {
  return (text || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Older accounts were created before these fields existed.
function ensureShape(user) {
  if (!user.shoppingList) user.shoppingList = [];
  if (!user.profile.shoppingPlaces) user.profile.shoppingPlaces = [];
}

function getPlaces(userId) {
  const user = userStore.findById(userId);
  return (user && user.profile.shoppingPlaces) || [];
}

// "the grocery store" / "Kroger" / "kroger on main" -> the saved place that best matches.
function findPlace(places, name) {
  const wanted = norm(name);
  if (!wanted) return null;
  return (
    places.find((p) => norm(p.name) === wanted) ||
    places.find((p) => norm(p.name).includes(wanted) || wanted.includes(norm(p.name))) ||
    null
  );
}

function addPlace(userId, name) {
  const clean = (name || '').trim();
  if (!clean) return null;
  let place = null;
  userStore.updateUser(userId, (user) => {
    ensureShape(user);
    place = findPlace(user.profile.shoppingPlaces, clean);
    if (!place || norm(place.name) !== norm(clean)) {
      place = { id: uuidv4(), name: clean, lat: null, lng: null };
      user.profile.shoppingPlaces.push(place);
    }
  });
  return place;
}

function addPlaces(userId, names) {
  return (names || []).map((n) => addPlace(userId, n)).filter(Boolean);
}

function setPlaceLocation(userId, placeId, lat, lng) {
  let updated = null;
  userStore.updateUser(userId, (user) => {
    ensureShape(user);
    const place = user.profile.shoppingPlaces.find((p) => p.id === placeId);
    if (place) {
      place.lat = lat;
      place.lng = lng;
      updated = place;
    }
  });
  return updated;
}

function removePlace(userId, placeId) {
  userStore.updateUser(userId, (user) => {
    ensureShape(user);
    user.profile.shoppingPlaces = user.profile.shoppingPlaces.filter((p) => p.id !== placeId);
    // Items that were for that store become "any store" instead of disappearing.
    user.shoppingList.forEach((i) => {
      if (i.placeId === placeId) i.placeId = null;
    });
  });
}

function addItem(userId, { item, placeId = null, placeName = null }) {
  const text = (item || '').trim();
  if (!text) return null;
  let created = null;
  userStore.updateUser(userId, (user) => {
    ensureShape(user);
    let resolvedPlaceId = placeId;
    if (!resolvedPlaceId && placeName) {
      let place = findPlace(user.profile.shoppingPlaces, placeName);
      if (!place) {
        place = { id: uuidv4(), name: placeName.trim(), lat: null, lng: null };
        user.profile.shoppingPlaces.push(place);
      }
      resolvedPlaceId = place.id;
    }
    // Don't list the same still-unbought thing twice for the same store.
    const duplicate = user.shoppingList.find(
      (i) => !i.done && norm(i.item) === norm(text) && (i.placeId || null) === (resolvedPlaceId || null)
    );
    if (duplicate) {
      created = duplicate;
      return;
    }
    created = {
      id: uuidv4(),
      item: text,
      placeId: resolvedPlaceId || null,
      createdAt: new Date().toISOString(),
      done: false,
      doneAt: null
    };
    user.shoppingList.push(created);
  });
  return created;
}

function setDone(userId, itemId, done) {
  let updated = null;
  userStore.updateUser(userId, (user) => {
    ensureShape(user);
    const entry = user.shoppingList.find((i) => i.id === itemId);
    if (entry) {
      entry.done = !!done;
      entry.doneAt = done ? new Date().toISOString() : null;
      updated = entry;
    }
  });
  return updated;
}

// Voice: "I got the milk" - match by what they said rather than an id.
function markBoughtByName(userId, itemName) {
  const user = userStore.findById(userId);
  if (!user) return null;
  ensureShape(user);
  const wanted = norm(itemName);
  const entry = user.shoppingList.find((i) => !i.done && (norm(i.item) === wanted || norm(i.item).includes(wanted) || wanted.includes(norm(i.item))));
  return entry ? setDone(userId, entry.id, true) : null;
}

function removeItem(userId, itemId) {
  userStore.updateUser(userId, (user) => {
    ensureShape(user);
    user.shoppingList = user.shoppingList.filter((i) => i.id !== itemId);
  });
}

// Oldest first: the order things were added is the order they're listed.
function getList(userId) {
  const user = userStore.findById(userId);
  if (!user) return { places: [], items: [] };
  const places = (user.profile.shoppingPlaces || []).map((p) => ({ ...p }));
  const items = (user.shoppingList || [])
    .slice()
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map((i) => ({ ...i, placeName: (places.find((p) => p.id === i.placeId) || {}).name || null }));
  return { places, items };
}

// Items worth mentioning at a given store: ones for that store, plus "any store" ones.
function openItemsForPlace(userId, placeId) {
  return getList(userId).items.filter((i) => !i.done && (i.placeId === placeId || !i.placeId));
}

function joinNatural(list) {
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

function buildArrivalMessage(placeName, items) {
  if (!items.length) return '';
  return `You're at ${placeName}. Don't forget to pick up: ${joinNatural(items.map((i) => i.item))}.`;
}

module.exports = {
  getPlaces,
  findPlace,
  addPlace,
  addPlaces,
  setPlaceLocation,
  removePlace,
  addItem,
  setDone,
  markBoughtByName,
  removeItem,
  getList,
  openItemsForPlace,
  buildArrivalMessage
};
