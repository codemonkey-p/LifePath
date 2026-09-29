const { v4: uuidv4 } = require('uuid');
const userStore = require('./userStore');
const profileNarrativeService = require('./profileNarrativeService');

const clean = (value, max) => String(value || '').trim().slice(0, max);
const norm = (value) => String(value || '').trim().toLowerCase();

// Medications saved by the voice wizard used to have no id; give them one so each can be
// changed or removed individually.
function list(userId) {
  const user = userStore.findById(userId);
  if (!user) return [];
  if ((user.profile.medications || []).some((m) => !m.id)) {
    userStore.updateUser(userId, (u) => {
      u.profile.medications = u.profile.medications.map((m) => (m.id ? m : { ...m, id: uuidv4() }));
    });
  }
  return userStore.findById(userId).profile.medications || [];
}

// Exact name first, then a unique partial match ("metformin" finds "Metformin 500mg").
function findByName(meds, name) {
  const wanted = norm(name);
  if (!wanted) return null;
  const exact = meds.find((m) => norm(m.name) === wanted);
  if (exact) return exact;
  const partial = meds.filter((m) => norm(m.name).includes(wanted) || wanted.includes(norm(m.name)));
  return partial.length === 1 ? partial[0] : null;
}

// Adds a medication, or updates the one already saved under that name - never duplicates.
function add(userId, { name, time, schedule }) {
  const medName = clean(name, 100);
  if (!medName) return { ok: false, error: 'Please give the medication name.' };

  let medication;
  let updated = false;
  const existing = findByName(list(userId), medName);
  userStore.updateUser(userId, (user) => {
    const meds = user.profile.medications || [];
    const match = existing && meds.find((m) => m.id === existing.id);
    if (match) {
      updated = true;
      if (time !== undefined && clean(time, 30)) match.time = clean(time, 30);
      if (schedule !== undefined && clean(schedule, 50)) match.schedule = clean(schedule, 50);
      medication = match;
    } else {
      medication = { id: uuidv4(), name: medName, time: clean(time, 30) || null, schedule: clean(schedule, 50) || null };
      meds.push(medication);
    }
    user.profile.medications = meds;
  });
  return { ok: true, medication, updated };
}

// Changes the details of a saved medication (found by id, or by name).
function update(userId, { id, name, newName, time, schedule }) {
  const meds = list(userId);
  const target = (id && meds.find((m) => m.id === id)) || findByName(meds, name);
  if (!target) return { ok: false, error: `No saved medication matches "${name || id}".` };

  let medication;
  userStore.updateUser(userId, (user) => {
    medication = user.profile.medications.find((m) => m.id === target.id);
    if (clean(newName, 100)) medication.name = clean(newName, 100);
    if (time !== undefined) medication.time = clean(time, 30) || null;
    if (schedule !== undefined) medication.schedule = clean(schedule, 50) || null;
  });
  return { ok: true, medication };
}

// Removes the medication AND everything else that would keep telling the person about it:
// its medication reminders, and any mention of it in the written biography.
function remove(userId, { id, name }) {
  const meds = list(userId);
  const target = (id && meds.find((m) => m.id === id)) || findByName(meds, name);
  if (!target) return { ok: false, error: `No saved medication matches "${name || id}".` };

  userStore.updateUser(userId, (user) => {
    user.profile.medications = user.profile.medications.filter((m) => m.id !== target.id);
    const gone = norm(target.name);
    user.reminders = (user.reminders || []).filter(
      (r) => !(r.type === 'medication' && norm(r.text).includes(gone))
    );
  });
  forgetInBiography(userId, target.name);
  return { ok: true, removed: target };
}

// The biography is rewritten by an LLM and may still say "they take X". Ask it to drop X.
// Runs in the background; the structured list (not the biography) is what the assistant trusts.
function forgetInBiography(userId, medName) {
  if (!profileNarrativeService.readNarrative(userId)) return;
  const user = userStore.findById(userId);
  profileNarrativeService
    .foldInNewInformation(
      userId,
      user?.profile?.preferredName || user?.name,
      `They no longer take ${medName}. Remove every mention of ${medName} from the biography (the medication itself, ` +
        'its dose and its times) and do not mention that it was removed.'
    )
    .catch((err) => console.error('[medications] biography cleanup failed:', err.message));
}

function describe(m) {
  const when = [m.time, m.schedule].filter(Boolean).join(', ');
  return `${m.name}${when ? ` (${when})` : ''}`;
}

// What the assistant is told, so it always works from the latest saved list.
function promptSection(userId) {
  const meds = list(userId);
  return (
    'Their medications right now (this saved list is the ONLY source of truth - if the biography below or an ' +
    'earlier conversation mentions a medication that is not in this list, they no longer take it, so never ' +
    'mention it):\n' +
    (meds.length ? meds.map((m) => `- ${describe(m)}`).join('\n') : 'None saved.')
  );
}

module.exports = { list, add, update, remove, describe, promptSection };
