const { v4: uuidv4 } = require('uuid');
const userStore = require('./userStore');
const { formatMonthDay } = require('./dateUtil');

const sessions = new Map();

function normalize(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

function isLenientMatch(answer, expected) {
  const a = normalize(answer);
  const e = normalize(expected);
  if (!a || !e) return false;
  if (a.includes(e) || e.includes(a)) return true;
  const aWords = new Set(a.split(/\s+/));
  const eWords = e.split(/\s+/);
  return eWords.some((w) => w.length > 2 && aWords.has(w));
}

function orientationQuestions() {
  const now = new Date();
  const day = now.toLocaleDateString('en-US', { weekday: 'long' });
  const month = now.getMonth();
  const season = month >= 2 && month <= 4 ? 'spring' : month >= 5 && month <= 7 ? 'summer' : month >= 8 && month <= 10 ? 'fall' : 'winter';
  return [
    { type: 'orientation', prompt: 'What day of the week is it today?', expected: day },
    { type: 'orientation', prompt: 'What season are we in right now?', expected: season }
  ];
}

function profileQuestions(user) {
  const questions = [];
  const { family, doctorAppointmentTiming } = user.profile;
  if (family && family.length > 0) {
    const member = family[Math.floor(Math.random() * family.length)];
    if (member.relation) {
      questions.push({ type: 'profile', prompt: `What's the name of your ${member.relation}?`, expected: member.name });
    }
  }
  if (doctorAppointmentTiming) {
    questions.push({ type: 'profile', prompt: 'When do you typically see your doctor?', expected: doctorAppointmentTiming });
  }
  return questions;
}

function photoQuestion(user) {
  const withPhoto = (user.profile.family || []).filter((m) => m.photoFilename);
  if (withPhoto.length === 0) return null;
  const member = withPhoto[Math.floor(Math.random() * withPhoto.length)];
  return {
    type: 'photo',
    prompt: 'Do you know who this is?',
    expected: member.name,
    relation: member.relation,
    birthday: member.birthday,
    memberId: member.id,
    stage: 0
  };
}

function startSession(userId) {
  const user = userStore.findById(userId);
  const questions = [...orientationQuestions(), ...profileQuestions(user)];
  const photoQ = photoQuestion(user);
  if (photoQ) questions.push(photoQ);

  const sessionId = uuidv4();
  sessions.set(sessionId, { userId, questions, index: 0, score: 0 });
  return { sessionId, question: questions[0], totalQuestions: questions.length };
}

function getSession(sessionId) {
  return sessions.get(sessionId);
}

function submitAnswer(sessionId, transcript) {
  const session = sessions.get(sessionId);
  if (!session) return null;
  const question = session.questions[session.index];

  if (question.type === 'photo') {
    const matched = isLenientMatch(transcript, question.expected) || (question.relation && isLenientMatch(transcript, question.relation));
    if (matched || question.stage >= 2) {
      session.score += matched ? 1 : 0;
      const feedback = matched
        ? `That's right, that's ${question.expected}!`
        : `That's ${question.expected}${question.relation ? `, your ${question.relation}` : ''} - now you know!`;
      return advance(session, feedback);
    }
    question.stage += 1;
    const hint =
      question.stage === 1 && question.birthday
        ? `Here's a hint - their birthday is ${formatMonthDay(question.birthday)}. Does that help?`
        : `This is ${question.expected}${question.relation ? `, your ${question.relation}` : ''} - does that sound right?`;
    return { done: false, feedback: hint, sameQuestion: true, question };
  }

  const matched = isLenientMatch(transcript, question.expected);
  session.score += matched ? 1 : 0;
  const feedback = matched ? 'Great job, that\'s right!' : `Good try! It's actually ${question.expected}.`;
  return advance(session, feedback);
}

function advance(session, feedback) {
  session.index += 1;
  const finished = session.index >= session.questions.length;
  return {
    done: finished,
    feedback,
    nextQuestion: finished ? null : session.questions[session.index],
    score: session.score,
    totalQuestions: session.questions.length
  };
}

module.exports = { startSession, getSession, submitAnswer };
