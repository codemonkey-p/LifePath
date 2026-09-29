const WebSocket = require('ws');
const config = require('../config');
const userStore = require('./userStore');
const reminderService = require('./reminderService');
const medicationService = require('./medicationService');
const profileWizardService = require('./profileWizardService');
const profileNarrativeService = require('./profileNarrativeService');
const shoppingService = require('./shoppingService');
const { normalizeBirthday, formatMonthDay } = require('./dateUtil');

const REALTIME_URL = `wss://api.openai.com/v1/realtime?model=${config.openai.realtimeModel}`;
const SAMPLE_RATE = 24000;

// Available in both the wizard and the companion, so a medication can be added, changed or
// removed by voice at any time and the change lands in the same saved list as the profile page.
const MEDICATION_TOOLS = [
  {
    type: 'function',
    name: 'add_medication',
    description:
      'Add a medication the person says they take, with the time and schedule if they said them. If it is already ' +
      'saved, this updates it instead of duplicating it.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        time: { type: 'string', description: 'e.g. "8:00 AM"' },
        schedule: { type: 'string', description: 'e.g. "Every day", "Weekdays", "Once a week", "Only when needed"' }
      },
      required: ['name']
    }
  },
  {
    type: 'function',
    name: 'update_medication',
    description:
      'Change the time, schedule or name of a medication that is already saved, when the person says it has changed.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The saved medication to change' },
        new_name: { type: 'string' },
        time: { type: 'string' },
        schedule: { type: 'string' }
      },
      required: ['name']
    }
  },
  {
    type: 'function',
    name: 'remove_medication',
    description: 'Remove a medication when the person says they have stopped taking it or asks you to delete it.',
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }
  }
];

const WIZARD_TOOLS = [
  {
    type: 'function',
    name: 'save_preferred_name',
    description: 'Save the name the person prefers to be called day-to-day.',
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }
  },
  {
    type: 'function',
    name: 'save_condition',
    description: 'Save which condition the person is seeking help for.',
    parameters: {
      type: 'object',
      properties: { condition: { type: 'string', enum: ["Parkinson's", "Alzheimer's", 'Other'] } },
      required: ['condition']
    }
  },
  {
    type: 'function',
    name: 'save_doctor_appointment_timing',
    description: "Save the person's typical doctor appointment timing/schedule, in their own words.",
    parameters: { type: 'object', properties: { timing: { type: 'string' } }, required: ['timing'] }
  },
  {
    type: 'function',
    name: 'save_medications',
    description: 'Save the medications the person takes and what time(s) they want to be reminded.',
    parameters: {
      type: 'object',
      properties: {
        medications: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: { type: 'string' }, time: { type: 'string' }, schedule: { type: 'string' } },
            required: ['name']
          }
        }
      },
      required: ['medications']
    }
  },
  {
    type: 'function',
    name: 'save_family',
    description:
      'Save one or more family members. Adds to the list already saved (call it again whenever they mention more ' +
      'relatives - earlier people are kept). Include the birthday only after confirming the date back to them.',
    parameters: {
      type: 'object',
      properties: {
        family: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              relation: { type: 'string', description: 'e.g. wife, son, granddaughter' },
              birthday: {
                type: 'string',
                description: 'Format YYYY-MM-DD, or MM-DD if the year is not known (e.g. "03-03"). Omit if unknown.'
              }
            },
            required: ['name']
          }
        }
      },
      required: ['family']
    }
  },
  {
    type: 'function',
    name: 'save_symptom_assessment',
    description:
      'Record what the person told you during the condition check-in (memory, walking, balance, tremor, handwriting, ' +
      'speech, daily tasks, sleep, mood, safety, walks/exercise). Save a few answers at a time as you go. Only record ' +
      'what they actually said - never diagnose or guess.',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              category: {
                type: 'string',
                enum: ['memory', 'movement', 'hand_function', 'speech', 'daily_activities', 'sleep_mood', 'safety', 'activity']
              },
              topic: { type: 'string', description: 'Short label, e.g. "Walking without support" or "Forgetting recent conversations"' },
              answer: { type: 'string', description: 'What they said, in brief, including any follow-up detail' },
              severity: {
                type: 'string',
                enum: ['none', 'mild', 'moderate', 'severe'],
                description: 'How much it affects them, judged only from what they said. Omit if unclear.'
              }
            },
            required: ['category', 'topic', 'answer']
          }
        },
        finished: {
          type: 'boolean',
          description: 'true on your final save, once the check-in is done or the person wants to stop'
        }
      },
      required: ['items']
    }
  },
  {
    type: 'function',
    name: 'save_shopping_places',
    description: 'Save the stores where the person typically shops (e.g. their usual grocery store or supermarket).',
    parameters: {
      type: 'object',
      properties: { places: { type: 'array', items: { type: 'string' }, description: 'Store names' } },
      required: ['places']
    }
  },
  {
    type: 'function',
    name: 'end_conversation',
    description:
      'Call this ONLY after you have said a warm goodbye out loud, when the conversation has reached its natural ' +
      'end or the person says they are done. It closes this session and returns them to the home screen.',
    parameters: { type: 'object', properties: {} }
  },
  {
    type: 'function',
    name: 'save_doctor_or_caretaker_name',
    description: "Save the person's doctor's or caretaker's name.",
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }
  },
  {
    type: 'function',
    name: 'save_emergency_contact',
    description:
      'Save the emergency contact name and phone number. Only call this AFTER reading the phone number back digit-by-digit and getting a clear yes confirmation from the person.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string' }, phone: { type: 'string' } },
      required: ['name', 'phone']
    }
  },
  {
    type: 'function',
    name: 'update_profile_note',
    description:
      'Save qualitative information about the person (condition-specific details, hobbies, routine, personality, life history) into their running biography.',
    parameters: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] }
  }
];

const COMPANION_TOOLS = [
  {
    type: 'function',
    name: 'add_shopping_item',
    description:
      'Add something to the person\'s shopping list when they ask you to remember to buy something. If they name a ' +
      'store, include it so they get reminded when they arrive there.',
    parameters: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'What to buy, e.g. "milk"' },
        place: { type: 'string', description: 'Store name if they mentioned one (e.g. "the grocery store"); omit otherwise' }
      },
      required: ['item']
    }
  },
  {
    type: 'function',
    name: 'mark_item_bought',
    description: 'Tick an item off the shopping list when the person says they already bought it.',
    parameters: { type: 'object', properties: { item: { type: 'string' } }, required: ['item'] }
  },
  {
    type: 'function',
    name: 'add_reminder',
    description: 'Add a new reminder the person asked for (medication, appointment, birthday, or other).',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        type: { type: 'string', enum: ['medication', 'appointment', 'birthday', 'other'] },
        time: { type: 'string', description: 'HH:MM if relevant' },
        date: { type: 'string', description: 'ISO date if relevant' },
        recurring: { type: 'string', enum: ['daily', 'yearly', 'once'] }
      },
      required: ['text', 'type', 'recurring']
    }
  },
  {
    type: 'function',
    name: 'update_profile_note',
    description:
      'Save something new and worth remembering that came up in casual conversation (hobbies, routine, feelings, ' +
      'life story). NEVER use this for family members, medications, stores, their doctor or their emergency ' +
      'contact - those have their own tools, and a note alone does NOT put them in the profile.',
    parameters: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] }
  }
];

// Anything that belongs in the saved profile (what the Profile page shows) must be saved with these,
// not just mentioned in a note - a note only reaches the written biography, never the profile.
for (const toolName of [
  'save_family',
  'save_shopping_places',
  'save_doctor_or_caretaker_name',
  'save_emergency_contact',
  'save_doctor_appointment_timing',
  'save_preferred_name'
]) {
  COMPANION_TOOLS.push(WIZARD_TOOLS.find((t) => t.name === toolName));
}

// Worded so it is unmistakable WHOSE birthday it is - an ambiguous phrasing once got a
// relative's birthday written into the main person's biography.
function describeFamilyMember(m) {
  const birthday = normalizeBirthday(m.birthday);
  const who = `${m.name} is their ${m.relation || 'family member'}`;
  return birthday ? `${who}, and ${m.name}'s (not their own) birthday is ${formatMonthDay(birthday)}` : who;
}

async function executeToolCall(mode, userId, name, args) {
  const user = userStore.findById(userId);
  const preferredName = user?.profile?.preferredName || user?.name;

  // Everything the person tells us also goes into the written "About" biography, in the
  // background so it never delays the assistant's reply.
  const remember = (fact, nameForHeading = preferredName) => {
    profileNarrativeService
      .foldInNewInformation(userId, nameForHeading, fact)
      .catch((err) => console.error('[realtime] background biography update failed:', err.message));
  };

  // Every medication result carries the latest saved list, so the assistant reads back what is really saved.
  const medicationResult = (result) => ({
    ...result,
    currentMedications: medicationService.list(userId).map(medicationService.describe)
  });

  switch (name) {
    case 'save_preferred_name':
      await profileWizardService.saveField(userId, 'preferredName', args.name);
      remember(`They prefer to be called ${args.name}.`, args.name);
      return { ok: true };
    case 'save_condition':
      await profileWizardService.saveField(userId, 'condition', args.condition);
      remember(`They are seeking help with ${args.condition}.`);
      return { ok: true };
    case 'save_doctor_appointment_timing':
      await profileWizardService.saveField(userId, 'doctorAppointmentTiming', args.timing);
      remember(`Their typical doctor appointment schedule: ${args.timing}.`);
      return { ok: true };
    // Medications live only in the saved list (never in the biography), so there is one source of truth.
    case 'save_medications':
      await profileWizardService.saveField(userId, 'medications', args.medications);
      return medicationResult({ ok: true });
    case 'add_medication': {
      const r = medicationService.add(userId, args);
      return medicationResult(r.ok ? { ok: true, updatedExisting: r.updated } : r);
    }
    case 'update_medication': {
      const r = medicationService.update(userId, { name: args.name, newName: args.new_name, time: args.time, schedule: args.schedule });
      return medicationResult(r.ok ? { ok: true } : r);
    }
    case 'remove_medication': {
      const r = medicationService.remove(userId, { name: args.name });
      return medicationResult(r.ok ? { ok: true, removed: r.removed.name } : r);
    }
    case 'save_family': {
      const members = args.family || [];
      const badBirthdays = members.filter((m) => m.birthday && !normalizeBirthday(m.birthday)).map((m) => m.name);
      await profileWizardService.saveField(userId, 'family', members);
      remember(`Family: ${members.map(describeFamilyMember).join('. ')}.`);
      const total = (userStore.findById(userId).profile.family || []).length;
      const result = { ok: true, familyMembersSavedSoFar: total };
      if (badBirthdays.length) {
        result.warning = `The birthday for ${badBirthdays.join(', ')} was not a valid date and was NOT saved. Ask again for the month and day.`;
      }
      return result;
    }
    case 'save_symptom_assessment': {
      const items = args.items || [];
      const total = profileWizardService.saveSymptoms(userId, items, !!args.finished);
      const condition = userStore.findById(userId).profile.condition;
      remember(
        `Regarding their ${condition || 'condition'}, they reported: ` +
          items.map((i) => `${i.topic} - ${i.answer}${i.severity && i.severity !== 'none' ? ` (${i.severity})` : ''}`).join('. ') +
          '.'
      );
      return { ok: true, topicsRecordedSoFar: total };
    }
    case 'save_shopping_places':
      await profileWizardService.saveField(userId, 'shoppingPlaces', args.places);
      remember(`They typically shop at: ${(args.places || []).join(', ')}.`);
      return { ok: true };
    case 'end_conversation':
      return { ok: true };
    case 'save_doctor_or_caretaker_name':
      await profileWizardService.saveField(userId, 'doctorOrCaretakerName', args.name);
      remember(`Their doctor or caretaker is ${args.name}.`);
      return { ok: true };
    case 'save_emergency_contact':
      await profileWizardService.saveField(userId, 'emergencyContact', { name: args.name, phone: args.phone });
      remember(`Their emergency contact is ${args.name}.`);
      return { ok: true };
    case 'add_shopping_item': {
      const created = shoppingService.addItem(userId, { item: args.item, placeName: args.place || null });
      if (!created) return { ok: false, error: 'No item was given.' };
      return { ok: true, confirmation: `Added ${created.item} to the shopping list${args.place ? ` for ${args.place}` : ''}.` };
    }
    case 'mark_item_bought': {
      const done = shoppingService.markBoughtByName(userId, args.item);
      return done ? { ok: true, confirmation: `Ticked off ${done.item}.` } : { ok: false, error: `${args.item} is not on the list.` };
    }
    case 'update_profile_note': {
      // Rewriting the biography takes an LLM call (seconds). Do it in the background so the
      // assistant can answer immediately instead of making the person wait for it.
      // (The condition check-in is completed by save_symptom_assessment, not by free-form notes.)
      const work = profileNarrativeService.foldInNewInformation(userId, preferredName, args.note);
      Promise.resolve(work).catch((err) => console.error('[realtime] background biography update failed:', err.message));
      return { ok: true };
    }
    case 'add_reminder':
      reminderService.addReminder(userId, args);
      return { ok: true, confirmation: `Reminder set: ${args.text}` };
    default:
      return { ok: false, error: `Unknown tool ${name}` };
  }
}

function buildSessionConfig(mode, user) {
  const tools = [...(mode === 'wizard' ? WIZARD_TOOLS : COMPANION_TOOLS), ...MEDICATION_TOOLS];
  let instructions;

  if (mode === 'wizard') {
    instructions = profileWizardService.buildSystemPrompt(user);
  } else {
    const biography = profileNarrativeService.readNarrative(user.id) || '(nothing recorded yet)';
    const family = user.profile.family || [];
    const familyText = family.length ? family.map((m) => `- ${describeFamilyMember(m)}`).join('\n') : 'None saved yet.';
    const dueReminders = reminderService.getDueNow(user.id);
    const dueText = dueReminders.length
      ? dueReminders.map((r) => `- ${r.text}`).join('\n')
      : 'Nothing is due right now.';
    const shopping = shoppingService.getList(user.id);
    const openItems = shopping.items.filter((i) => !i.done);
    const shoppingText = openItems.length
      ? openItems.map((i) => `- ${i.item}${i.placeName ? ` (for ${i.placeName})` : ''}`).join('\n')
      : 'The shopping list is empty.';
    const placesText = shopping.places.length ? shopping.places.map((p) => p.name).join(', ') : 'none saved yet';
    instructions =
      `${profileWizardService.TONE_GUIDANCE}\n\n` +
      `You are a warm, natural-sounding voice companion for ${user.name}. Have a real, open conversation - ` +
      "you are not reading a script. Before chatting, gently mention anything due today from this list " +
      `(skip this if nothing is due):\n${dueText}\n\nWhat you know about them:\n${biography}\n\n` +
      `${medicationService.promptSection(user.id)}\n\n${profileWizardService.MEDICATION_RULE}` +
      `Their family (from their saved profile):\n${familyText}\n\n` +
      `Their shopping list right now (oldest first):\n${shoppingText}\nPlaces they shop: ${placesText}\n\n` +
      'If they tell you about a new family member or friend (name, relationship, birthday), call save_family - ' +
      'not update_profile_note or add_reminder; it also sets up the birthday reminder. Likewise use ' +
      'save_shopping_places, save_doctor_or_caretaker_name and save_emergency_contact for those. ' +
      'If they ask to be reminded of something, call add_reminder. If they mention something new worth ' +
      'remembering, call update_profile_note. If they ask you to add something to their shopping list, call ' +
      'add_shopping_item (include the store if they name one); if they say they already got something, call ' +
      'mark_item_bought. You can read the list back to them when asked.\n\n' +
      'CRITICAL SAFETY RULE: only call add_reminder, update_profile_note, the medication tools or the shopping tools when the person has clearly and ' +
      'explicitly said that information themselves. Never call a tool based on a guess or an example you ' +
      "suggested - if you're not confident what they said, ask them to repeat it instead.\n\n" +
      'START THE CONVERSATION YOURSELF right away - do not wait for them to speak first. Open with something ' +
      `like "Hey ${user.profile.preferredName || user.name}, I'm here to help you. How are you feeling today?" ` +
      'and, if anything is due today, mention it right after that opening.';
  }

  return {
    type: 'session.update',
    session: {
      type: 'realtime',
      model: config.openai.realtimeModel,
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: SAMPLE_RATE },
          transcription: { model: config.openai.transcriptionModel, language: 'en' },
          ...(config.openai.noiseReduction !== 'off' && {
            noise_reduction: { type: config.openai.noiseReduction }
          }),
          turn_detection: {
            type: 'server_vad',
            threshold: config.openai.vadThreshold,
            silence_duration_ms: config.openai.vadSilenceMs,
            prefix_padding_ms: 300,
            // We decide when to answer and when a sound counts as an interruption (see
            // attachRealtimeBridge) - letting the service react to every noise cut off the
            // assistant's own greeting whenever its voice echoed back into the microphone.
            create_response: false,
            interrupt_response: false
          }
        },
        output: {
          format: { type: 'audio/pcm', rate: SAMPLE_RATE },
          voice: config.openai.ttsVoice
        }
      },
      instructions,
      tools,
      tool_choice: 'auto'
    }
  };
}

function attachRealtimeBridge(clientSocket, { mode, userId }) {
  const user = userStore.findById(userId);
  if (!user) {
    clientSocket.close(4401, 'Unauthorized');
    return;
  }

  const upstream = new WebSocket(REALTIME_URL, {
    headers: {
      Authorization: `Bearer ${config.openai.apiKey}`
    }
  });

  const pendingCalls = new Map();
  let greeted = false;
  let silenceTimer = null;
  let nudgeCount = 0;
  let paused = false;
  let responseActive = false;
  let endAfterResponse = false;
  let audioInResponse = 0;
  let endWhenNextSpoken = false;
  // True only once a real transcript of the person's speech has arrived for the current turn.
  // Saves are refused without it, so background noise or a nudge can never become "an answer".
  let heardSpeech = false;
  let lastTranscript = '';

  // --- Turn-taking (we, not the service, decide when a sound is a real interruption) ---
  const BARGE_IN_MIN_MS = 900; // speech must last this long to interrupt the assistant
  const MIN_SPEECH_MS = 250; // shorter sounds (clicks, coughs) are never treated as an answer
  let playUntil = 0; // estimated moment the browser finishes playing the audio we've sent it
  let userSpeaking = false;
  let speechStartedAt = 0;
  let lastSpeechMs = 0;
  let turnIgnored = false; // sound heard while the assistant was talking that wasn't a real interruption
  let bargeTimer = null;
  let firstResponseDone = false;
  let greetingProtectUntil = 0;
  let pendingResponse = false;
  const droppedItems = new Set();

  // Playback in the browser lags the server (audio arrives faster than it plays), so "the
  // assistant is talking" means still generating OR still audibly playing.
  function assistantBusy() {
    return responseActive || Date.now() < playUntil - 200;
  }

  function requestResponse() {
    if (responseActive) {
      pendingResponse = true;
    } else {
      upstream.send(JSON.stringify({ type: 'response.create' }));
    }
  }

  function confirmBargeIn() {
    bargeTimer = null;
    if (!userSpeaking || paused) return;
    console.log(`[realtime:${mode}] interruption confirmed (${BARGE_IN_MIN_MS}ms of sustained speech)`);
    turnIgnored = false;
    heardSpeech = false;
    endWhenNextSpoken = false;
    clearSilenceTimer();
    nudgeCount = 0;
    if (responseActive) upstream.send(JSON.stringify({ type: 'response.cancel' }));
    playUntil = 0;
    clientSocket.send(JSON.stringify({ type: 'interrupt' }));
  }

  function looksLikeRealSpeech(text) {
    const cleaned = (text || '').toLowerCase().replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!cleaned) return false;
    const junk = ['you', 'thank you', 'thanks', 'bye', 'thanks for watching', 'okay', 'uh', 'um', 'hmm', 'mm'];
    return !junk.includes(cleaned);
  }

  async function waitForSpeechTranscript(maxMs) {
    const start = Date.now();
    while (!heardSpeech && Date.now() - start < maxMs) {
      await new Promise((r) => setTimeout(r, 100));
    }
    return heardSpeech;
  }
  const NO_RESPONSE_TIMEOUT_MS = 15000;
  const MAX_AUTO_NUDGES = 2;

  function clearSilenceTimer() {
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
  }

  function armSilenceTimer() {
    clearSilenceTimer();
    if (nudgeCount >= MAX_AUTO_NUDGES) return;
    silenceTimer = setTimeout(() => {
      if (upstream.readyState !== WebSocket.OPEN || paused) return;
      if (assistantBusy() || userSpeaking) {
        armSilenceTimer(); // still mid-conversation - check again later
        return;
      }
      nudgeCount += 1;
      heardSpeech = false;
      upstream.send(
        JSON.stringify({
          type: 'response.create',
          response: {
            // The person said nothing, so there is nothing to save - never allow tool calls here.
            tool_choice: 'none',
            instructions:
              "The person has NOT said anything - they may be thinking, distracted, or didn't hear you. Do " +
              'not assume, guess, or make up any answer for them, and do not act as if they told you ' +
              'something. Just gently check in and rephrase your last question more simply. Keep it brief ' +
              'and unhurried, no pressure.'
          }
        })
      );
    }, NO_RESPONSE_TIMEOUT_MS);
  }

  upstream.on('open', () => {
    console.log(`[realtime:${mode}] connected to OpenAI, sending session.update`);
    upstream.send(JSON.stringify(buildSessionConfig(mode, userStore.findById(userId))));
  });

  upstream.on('unexpected-response', (req, res) => {
    let body = '';
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => console.error(`[realtime:${mode}] OpenAI rejected connection: ${res.statusCode} ${body}`));
  });

  upstream.on('message', async (raw) => {
    let event;
    try {
      event = JSON.parse(raw.toString());
    } catch (err) {
      return;
    }

    if (process.env.DEBUG_REALTIME) console.log(`[realtime:${mode}] event:`, event.type);

    if (event.type === 'session.updated' && !greeted) {
      greeted = true;
      upstream.send(JSON.stringify({ type: 'response.create' }));
      return;
    }

    if (event.type === 'response.created') {
      responseActive = true;
      audioInResponse = 0;
    }

    if (event.type === 'input_audio_buffer.speech_started') {
      if (paused) return;
      userSpeaking = true;
      speechStartedAt = Date.now();

      if (assistantBusy()) {
        // Something made a sound while the assistant was talking: it could be the person, or
        // just the assistant's own voice echoing back, or room noise. Don't react yet.
        turnIgnored = true;
        const greetingProtected = !firstResponseDone || Date.now() < greetingProtectUntil;
        if (!greetingProtected) bargeTimer = setTimeout(confirmBargeIn, BARGE_IN_MIN_MS);
        return;
      }

      turnIgnored = false;
      clearSilenceTimer();
      nudgeCount = 0;
      heardSpeech = false;
      endWhenNextSpoken = false; // they said something more - don't hang up on them
      return;
    }

    if (event.type === 'input_audio_buffer.speech_stopped') {
      userSpeaking = false;
      lastSpeechMs = Date.now() - speechStartedAt;
      if (bargeTimer) {
        clearTimeout(bargeTimer);
        bargeTimer = null;
      }
      return;
    }

    if (event.type === 'input_audio_buffer.committed') {
      const itemId = event.item_id;
      const drop = (why) => {
        console.log(`[realtime:${mode}] ignored a sound (${why})`);
        if (itemId) {
          droppedItems.add(itemId);
          upstream.send(JSON.stringify({ type: 'conversation.item.delete', item_id: itemId }));
        }
      };
      if (paused) return drop('paused');
      if (turnIgnored) {
        turnIgnored = false;
        return drop('heard while the assistant was talking, not a real interruption');
      }
      if (lastSpeechMs < MIN_SPEECH_MS) return drop(`only ${lastSpeechMs}ms of sound`);
      clientSocket.send(JSON.stringify({ type: 'thinking' }));
      requestResponse();
      return;
    }

    if (event.type === 'conversation.item.input_audio_transcription.completed') {
      if (droppedItems.has(event.item_id)) return;
      lastTranscript = (event.transcript || '').trim();
      const real = looksLikeRealSpeech(lastTranscript);
      console.log(`[realtime:${mode}] heard: ${JSON.stringify(lastTranscript)} -> ${real ? 'real speech' : 'ignored as noise'}`);
      if (real) heardSpeech = true;
      return;
    }

    if (event.type === 'response.done') {
      responseActive = false;
      if (endWhenNextSpoken && audioInResponse > 0) {
        endWhenNextSpoken = false;
        endAfterResponse = true;
      }
      if (endAfterResponse) {
        endAfterResponse = false;
        clearSilenceTimer();
        console.log(`[realtime:${mode}] conversation ended by the assistant after saying goodbye`);
        clientSocket.send(JSON.stringify({ type: 'conversation_ended' }));
        return;
      }
      if (!firstResponseDone) {
        // The opening greeting can't be interrupted, however long it takes to finish playing.
        firstResponseDone = true;
        greetingProtectUntil = playUntil;
      }
      if (pendingResponse && !paused) {
        pendingResponse = false;
        upstream.send(JSON.stringify({ type: 'response.create' }));
        return;
      }
      if (!paused) armSilenceTimer();
    }

    if (event.type === 'response.audio.delta' || event.type === 'response.output_audio.delta') {
      audioInResponse += 1;
      if (paused) return;
      // base64 -> bytes -> 16-bit samples at 24kHz -> milliseconds of speech
      const chunkMs = (event.delta.length * 0.75) / 2 / 24;
      playUntil = Math.max(Date.now(), playUntil) + chunkMs;
      clientSocket.send(JSON.stringify({ type: 'audio_out', audio: event.delta }));
      return;
    }

    if (event.type === 'response.audio_transcript.delta' || event.type === 'response.output_audio_transcript.delta') {
      if (paused) return;
      clientSocket.send(JSON.stringify({ type: 'assistant_transcript_delta', text: event.delta }));
      return;
    }

    if (event.type === 'response.function_call_arguments.done') {
      const { call_id: callId, name } = event;
      let args = {};
      try {
        args = JSON.parse(event.arguments || '{}');
      } catch (err) {
        args = {};
      }
      let result;
      if (await waitForSpeechTranscript(2000)) {
        result = await executeToolCall(mode, userId, name, args);
        profileWizardService.maybeCompleteSession(userId);
      } else {
        console.log(`[realtime:${mode}] REFUSED ${name} - no clear spoken answer was transcribed for this turn`);
        result = {
          ok: false,
          error:
            'Nothing was saved. No clear spoken answer from the person was heard (it may have been background ' +
            "noise). Do not assume an answer - tell them you didn't quite catch that and ask again."
        };
      }

      upstream.send(
        JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify(result)
          }
        })
      );
      if (name === 'end_conversation' && result.ok && audioInResponse === 0) {
        console.log(`[realtime:${mode}] end_conversation refused - no goodbye was spoken yet`);
        // Don't rely on the model asking twice: as soon as it has spoken its goodbye, we end.
        endWhenNextSpoken = true;
        result = {
          ok: false,
          error:
            'The conversation was NOT ended because you have not said goodbye out loud yet. Say a short, warm ' +
            'goodbye now (for example "Take care, and talk soon!"), and then call end_conversation again.'
        };
      }

      if (name === 'end_conversation' && result.ok) {
        // The goodbye was already spoken in this same turn. Say nothing more; once this
        // response finishes, tell the browser to close the session after playback drains.
        endAfterResponse = true;
        if (!responseActive) {
          endAfterResponse = false;
          clearSilenceTimer();
          clientSocket.send(JSON.stringify({ type: 'conversation_ended' }));
        }
      } else if (!paused) {
        // While paused, stay silent; the resume handler will pick the conversation back up.
        upstream.send(JSON.stringify({ type: 'response.create' }));
      }

      const refreshedUser = userStore.findById(userId);
      clientSocket.send(
        JSON.stringify({
          type: 'profile_updated',
          profile: refreshedUser.profile,
          firstLoginCompleted: refreshedUser.firstLoginCompleted,
          complete: profileWizardService.isProfileComplete(refreshedUser.profile)
        })
      );
      return;
    }

    if (event.type === 'error') {
      // Cancelling a response that just finished on its own is harmless - don't surface it.
      if (event.error?.code === 'response_cancel_not_active') return;
      clientSocket.send(JSON.stringify({ type: 'error', message: event.error?.message || 'Realtime session error' }));
    }
  });

  upstream.on('error', (err) => {
    clientSocket.send(JSON.stringify({ type: 'error', message: 'Voice service connection error.' }));
  });

  upstream.on('close', () => {
    clearSilenceTimer();
    try {
      clientSocket.close();
    } catch (err) {}
  });

  clientSocket.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (err) {
      return;
    }
    if (upstream.readyState !== WebSocket.OPEN) return;

    if (msg.type === 'audio_in') {
      if (paused) return;
      upstream.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: msg.audio }));
    } else if (msg.type === 'pause') {
      console.log(`[realtime:${mode}] paused by user`);
      paused = true;
      clearSilenceTimer();
      playUntil = 0;
      userSpeaking = false;
      pendingResponse = false;
      if (bargeTimer) {
        clearTimeout(bargeTimer);
        bargeTimer = null;
      }
      if (responseActive) upstream.send(JSON.stringify({ type: 'response.cancel' }));
      upstream.send(JSON.stringify({ type: 'input_audio_buffer.clear' }));
    } else if (msg.type === 'resume') {
      console.log(`[realtime:${mode}] resumed by user`);
      paused = false;
      nudgeCount = 0;
      pendingResponse = false;
      if (!responseActive) {
        upstream.send(
          JSON.stringify({
            type: 'response.create',
            response: {
              tool_choice: 'none',
              instructions:
                'The person paused the conversation for a bit and has now come back. Welcome them back in one ' +
                'short, warm sentence, then re-ask the question you were in the middle of asking (rephrase it a ' +
                'little). Only refer to things that were genuinely said in this conversation - never invent or ' +
                'assume a topic you did not actually discuss. Keep it brief.'
            }
          })
        );
      }
    }
  });

  clientSocket.on('close', () => {
    clearSilenceTimer();
    try {
      upstream.close();
    } catch (err) {}
  });
}

module.exports = { attachRealtimeBridge };
