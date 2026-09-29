const { v4: uuidv4 } = require('uuid');
const userStore = require('./userStore');
const profileNarrativeService = require('./profileNarrativeService');
const reminderService = require('./reminderService');
const medicationService = require('./medicationService');
const shoppingService = require('./shoppingService');
const { normalizeBirthday } = require('./dateUtil');

// Once they've told us their condition, the assistant does a short, gentle symptom check-in like
// a clinic intake: specific questions with examples, going deeper on whatever they say is hard.
const CONDITION_SCREENING =
  'a short, gentle symptom and daily-function check-in specific to their condition, like a caring clinic ' +
  'intake. Ask 5 or 6 questions in total, ONE at a time, and always offer a plain example so they know what you ' +
  'mean (for instance "Some people find they forget recent conversations - does that happen to you?"). Pick ' +
  'questions from the list that matches their condition:\n' +
  '  ALZHEIMER\'S / memory: forgetting recent things or conversations; repeating questions or stories; misplacing ' +
  'everyday items (keys, glasses); feeling unsure of the day, date, or where they are; getting lost in a familiar ' +
  'place; trouble finding the right word or remembering names; difficulty with familiar tasks like cooking, paying ' +
  'bills, or taking medications on time; changes in mood or feeling anxious or withdrawn; whether they feel safe ' +
  'at home alone; whether they go for walks and can get around the neighborhood confidently.\n' +
  '  PARKINSON\'S / movement: tremor or shaking (which hand? at rest or when using it?); stiffness or feeling ' +
  'slow; whether they can walk steadily without support and how their balance is, any falls or near-falls; ' +
  'freezing or shuffling when walking; whether they can write their name and whether their handwriting has become ' +
  'smaller or shakier; trouble holding a pen, fork, or buttoning clothes; a softer voice or trouble being heard; ' +
  'trouble sleeping; low mood or anxiety; whether they go for walks or exercise.\n' +
  '  ANY OTHER condition: the main day-to-day difficulties, memory, walking and balance, hand use, sleep, mood, ' +
  'and whether they go for walks.\n' +
  'GO DEEPER based on their answers: if something is a problem, ask ONE natural follow-up (how often, since ' +
  'when, whether it has caused a fall or a scare, whether someone helps them, what they do about it). If it is ' +
  'fine, briefly acknowledge and move on - do not interrogate. If they would rather not answer something, skip it. ' +
  'Stay warm and calm, never alarming, and NEVER diagnose or give medical advice - you are only listening and ' +
  'recording so their doctor and family can understand. Save what they tell you with save_symptom_assessment, ' +
  'a few answers at a time (each with a short topic, their answer in brief, and how much it affects them: none, ' +
  'mild, moderate or severe - based only on what THEY said). Set finished to true on your last save, once you ' +
  'have asked your 5 or 6 questions or they want to stop';

const REQUIRED_FIELDS = [
  { key: 'preferredName', label: 'the name they prefer to be called day-to-day' },
  { key: 'condition', label: "which condition they're seeking help for (Parkinson's, Alzheimer's, or other)" },
  { key: 'conditionDetails', label: CONDITION_SCREENING },
  { key: 'doctorAppointmentTiming', label: 'their typical doctor appointment timing/schedule' },
  { key: 'medications', label: 'what medications they take and what times they want reminders' },
  {
    key: 'family',
    label:
      'their family members. For EACH person get their name, how they are related to them, and their birthday ' +
      '(month and day - the year is optional). When you hear a birthday, say the date back to confirm it ("so ' +
      'that\'s March 3rd, right?") before saving, because you will use it to remind them to wish that person ' +
      'happy birthday. After the FIRST person, gently ask once: "Would you like to add more family members? I can ' +
      'remind you of their birthdays too." Aim for about three or four people if they are happy to share, but never ' +
      'push - if they say no or seem done, move on. If they truly do not remember a birthday, skip it'
  },
  {
    key: 'shoppingPlaces',
    label:
      'where they typically shop (for example their usual grocery store or supermarket - one or two places is ' +
      'plenty). Explain briefly that you can remind them what to buy when they are at the store'
  },
  { key: 'doctorOrCaretakerName', label: "their doctor's or caretaker's name" },
  { key: 'emergencyContact', label: 'an emergency contact name and phone number, confirmed by reading the number back' }
];

function isFieldMissing(profile, key) {
  switch (key) {
    case 'preferredName':
      return !profile.preferredName;
    case 'condition':
      return !profile.condition;
    case 'conditionDetails':
      return profile.condition && !profile.conditionDetailsCaptured;
    case 'doctorAppointmentTiming':
      return !profile.doctorAppointmentTiming;
    case 'medications':
      return !profile.medications || profile.medications.length === 0;
    case 'family':
      return !profile.family || profile.family.length === 0;
    case 'shoppingPlaces':
      return !profile.shoppingPlaces || profile.shoppingPlaces.length === 0;
    case 'doctorOrCaretakerName':
      return !profile.doctorOrCaretakerName;
    case 'emergencyContact':
      return !profile.emergencyContact;
    default:
      return false;
  }
}

function getMissingFields(profile) {
  return REQUIRED_FIELDS.filter((f) => isFieldMissing(profile, f.key));
}

function isProfileComplete(profile) {
  return getMissingFields(profile).length === 0;
}

const TONE_GUIDANCE =
  'TONE: Speak like a warm, calm, friendly companion - the way an unhurried, kind friend talks over a cup ' +
  'of tea, not a somber caregiver and not a customer-service script. Keep your energy relaxed and steady, ' +
  'not high or excitable - warmth comes through in patience and genuine interest, not enthusiasm or ' +
  'exclamation. Only soften further into something gentler in the specific moment they share something ' +
  'genuinely difficult, and keep the rest of the conversation calm and pleasant, not heavy.\n\n' +
  'Natural human conversation has small, occasional verbal reactions woven in here and there ("mm-hmm", ' +
  '"oh nice", "got it", "ha, okay", "sure thing") - let a few of these come through naturally where they ' +
  "genuinely fit, the way a real person's speech has them, but don't force one into every single response " +
  "or reuse the same one repeatedly - that reads as robotic and scripted, which is exactly what to avoid. " +
  "Plenty of responses can just be a normal, natural sentence with no filler at all. Speak like a real " +
  'person actually talking, not like you are following a checklist.\n\n' +
  'PACING: Keep each turn short - a sentence or two - and then stop and actually let them talk. This person ' +
  'may speak slowly or need a moment to think before answering, so give them real space: do not rush to fill ' +
  'silence, and do not chain multiple questions or thoughts together in one long turn.\n\n' +
  'BACKGROUND NOISE: the microphone may pick up TV, other people, coughs, typing, or room noise. Only treat ' +
  'something as their answer if it is clearly a person speaking directly to you and actually answers what you ' +
  'asked. If what you heard is noise, a fragment, background chatter, unrelated to your question, or you are not ' +
  "sure it was meant for you, do NOT assume an answer and do NOT move on - say something like \"Sorry, I didn't " +
  'quite catch that" and ask again. Never fill in or guess a missing answer yourself.';

const ENDING_RULE =
  'ENDING THE CONVERSATION: when you have covered everything you needed, or the person tells you they are ' +
  "finished, have to go, or have nothing more to add (\"that's all\", \"goodbye\", \"I'm done\"), wrap up. Say a " +
  'short warm goodbye out loud first - for example "Thank you so much for sharing all of that. Take care, and ' +
  'I\'ll talk to you soon!" - and then, in that same turn, call the end_conversation tool. Never call ' +
  'end_conversation before you have said your goodbye, and do not end while important things are still ' +
  "missing unless they asked to stop. After calling it, say nothing more.\n\n";

// Shared with the companion prompt (see realtimeSessionService).
const MEDICATION_RULE =
  'MEDICATIONS: use add_medication when they mention a new medication (with its time and schedule if they say ' +
  'them), update_medication when they change a time, schedule or name, and remove_medication when they say they ' +
  'have stopped taking one. Each tool replies with the latest saved list - trust that reply.\n\n';

function buildSystemPrompt(user) {
  const missing = getMissingFields(user.profile);
  const biography = profileNarrativeService.readNarrative(user.id) || '(nothing recorded yet)';

  if (missing.length > 0) {
    const nextField = missing[0];
    return (
      `${TONE_GUIDANCE}\n\n` +
      `You are conducting a warm, natural voice interview with ${user.name}, a patient of this care app, ` +
      "to build up their profile. This is a real spoken conversation - ask ONE thing at a time and wait " +
      "for their answer before moving on. Still-missing information, in priority order:\n" +
      missing.map((f, i) => `${i + 1}. ${f.label}`).join('\n') +
      `\n\nRight now, focus on: ${nextField.label}. Once you have a clear answer for it, call the matching ` +
      'save_* tool for that field (save_preferred_name, save_condition, save_doctor_appointment_timing, ' +
      'save_medications, save_family, save_shopping_places, save_doctor_or_caretaker_name, or ' +
      'save_emergency_contact), or save_symptom_assessment for the condition check-in, or ' +
      'update_profile_note for anything else qualitative, then naturally move to ' +
      'the next missing item. If they mention something for a later item while answering an earlier one, ' +
      'capture it too rather than asking again.\n\n' +
      'CRITICAL SAFETY RULE: only call a save_* tool when the person has clearly and explicitly stated that ' +
      'exact information themselves. Never call a tool based on a guess, an assumption, or an example name ' +
      'or answer you yourself suggested while asking the question - if their answer was unclear, silent, or ' +
      "you're not confident what they said, ask them to repeat it instead of calling a tool. It is much " +
      'better to ask again than to save something incorrect.\n\n' +
      MEDICATION_RULE +
      `${medicationService.promptSection(user.id)}\n\n` +
      ENDING_RULE +
      'START THE CONVERSATION YOURSELF right away with a short, warm greeting - do not wait for them to speak ' +
      'first. ' +
      (user.profile.preferredName
        ? `Open with something like "Hi ${user.profile.preferredName}!" since you already know their name, `
        : 'This is their very first time here, so open with exactly: "Hi there, welcome to LifePath!" ') +
      `then ask about ${nextField.label}.\n\n` +
      `Known biography so far:\n${biography}`
    );
  }

  return (
    `${TONE_GUIDANCE}\n\n` +
    `You are having an ongoing, warm voice conversation with ${user.name}. Their profile's required ` +
    'information is already complete. From here, either (a) gently go deeper - ask about hobbies, daily ' +
    'routine, more family members, or life history that would help you understand them better, or ' +
    '(b) occasionally validate something already known by mentioning it and asking if it is still accurate, ' +
    'phrased naturally rather than as a repeat of an old question. Use the update_profile_note tool to save ' +
    'anything new.\n\n' +
    MEDICATION_RULE +
    `${medicationService.promptSection(user.id)}\n\n` +
    ENDING_RULE +
    'START THE CONVERSATION YOURSELF right away - do not wait for them to speak first. Open with something ' +
    `like "Hey ${user.profile.preferredName || user.name}, let's get to know a little more about you today" ` +
    'and then smoothly go into whichever topic from (a) or (b) above feels most natural to ask about next.\n\n' +
    `Known biography so far:\n${biography}`
  );
}

// Adds new people and updates ones already saved (matched by name), so calling this several
// times as the person mentions more relatives builds up the list instead of replacing it.
function mergeFamily(existing, incoming) {
  const merged = existing.slice();
  for (const member of incoming) {
    const name = (member.name || '').trim();
    if (!name) continue;
    const birthday = normalizeBirthday(member.birthday);
    const match = merged.find((m) => m.name.trim().toLowerCase() === name.toLowerCase());
    if (match) {
      if (member.relation) match.relation = member.relation;
      if (birthday) match.birthday = birthday;
    } else {
      merged.push({ id: uuidv4(), name, relation: member.relation || null, birthday, photoFilename: null });
    }
  }
  return merged;
}

const SYMPTOM_CATEGORIES = ['memory', 'movement', 'hand_function', 'speech', 'daily_activities', 'sleep_mood', 'safety', 'activity'];
const SEVERITIES = ['none', 'mild', 'moderate', 'severe'];

// Records what the person said about a symptom or daily-function topic. Answering the same
// topic again (e.g. later, "actually it's gotten worse") updates the entry instead of duplicating.
function saveSymptoms(userId, items, finished) {
  let total = 0;
  userStore.updateUser(userId, (user) => {
    const list = user.profile.symptoms || [];
    for (const item of items || []) {
      const topic = (item.topic || '').trim();
      const answer = (item.answer || '').trim();
      if (!topic || !answer) continue;
      const entry = {
        category: SYMPTOM_CATEGORIES.includes(item.category) ? item.category : 'daily_activities',
        topic,
        answer,
        severity: SEVERITIES.includes(item.severity) ? item.severity : null,
        updatedAt: new Date().toISOString()
      };
      const existing = list.find((s) => s.topic.toLowerCase() === topic.toLowerCase());
      if (existing) Object.assign(existing, entry);
      else list.push({ id: uuidv4(), ...entry });
    }
    user.profile.symptoms = list;
    total = list.length;
    if (finished || total >= 5) user.profile.conditionDetailsCaptured = true;
  });
  return total;
}

async function saveField(userId, fieldName, value) {
  if (fieldName === 'shoppingPlaces') {
    shoppingService.addPlaces(userId, value);
    return userStore.findById(userId);
  }

  // Adds to (never replaces) the saved list, so medications added on the profile page survive.
  if (fieldName === 'medications') {
    for (const med of value || []) medicationService.add(userId, med);
    return userStore.findById(userId);
  }

  const result = userStore.updateUser(userId, (user) => {
    if (fieldName === 'preferredName') user.profile.preferredName = value;
    if (fieldName === 'condition') user.profile.condition = value;
    if (fieldName === 'doctorAppointmentTiming') user.profile.doctorAppointmentTiming = value;
    if (fieldName === 'doctorOrCaretakerName') user.profile.doctorOrCaretakerName = value;
    if (fieldName === 'emergencyContact') user.profile.emergencyContact = value;
    if (fieldName === 'family') user.profile.family = mergeFamily(user.profile.family || [], value);
  });

  if (fieldName === 'family') reminderService.syncBirthdayReminders(userId);
  return result;
}

async function recordConditionDetails(userId, preferredName, newInfoText) {
  userStore.updateUser(userId, (user) => {
    user.profile.conditionDetailsCaptured = true;
  });
  return profileNarrativeService.foldInNewInformation(userId, preferredName, newInfoText);
}

async function recordNarrativeNote(userId, preferredName, newInfoText) {
  return profileNarrativeService.foldInNewInformation(userId, preferredName, newInfoText);
}

// True once the person has told us anything at all - used to switch the Home button from
// "Tell me about yourself" to "Tell me more about yourself".
function hasStarted(profile) {
  return !!(
    profile.wizardSessionsCompleted > 0 ||
    profile.preferredName ||
    profile.condition ||
    profile.doctorAppointmentTiming ||
    profile.doctorOrCaretakerName ||
    profile.emergencyContact ||
    (profile.medications && profile.medications.length) ||
    (profile.family && profile.family.length) ||
    (profile.shoppingPlaces && profile.shoppingPlaces.length) ||
    (profile.symptoms && profile.symptoms.length)
  );
}

// Counted once, at the moment the profile first becomes complete (it used to add one on
// every save after that).
function maybeCompleteSession(userId) {
  const user = userStore.findById(userId);
  if (!user) return;
  if (isProfileComplete(user.profile) && !user.profile.wizardCompletedOnce) {
    userStore.updateUser(userId, (u) => {
      u.profile.wizardCompletedOnce = true;
      u.profile.wizardSessionsCompleted += 1;
    });
  }
}

module.exports = {
  MEDICATION_RULE,
  REQUIRED_FIELDS,
  TONE_GUIDANCE,
  getMissingFields,
  isProfileComplete,
  hasStarted,
  buildSystemPrompt,
  saveField,
  saveSymptoms,
  recordConditionDetails,
  recordNarrativeNote,
  maybeCompleteSession
};
