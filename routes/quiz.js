const express = require('express');
const { requireAuth } = require('../middleware/session');
const { audioUpload } = require('../middleware/upload');
const asyncHandler = require('../middleware/asyncHandler');
const quizService = require('../services/quizService');
const sttService = require('../services/sttService');
const ttsService = require('../services/ttsService');

const router = express.Router();

function photoUrlFor(question) {
  return question && question.type === 'photo' ? `/api/profile/family/${question.memberId}/photo` : null;
}

router.post('/start', requireAuth, asyncHandler(async (req, res) => {
  const { sessionId, question, totalQuestions } = quizService.startSession(req.user.id);
  const audio = await ttsService.synthesizeSpeech(question.prompt);
  res.json({
    sessionId,
    question: question.prompt,
    photoUrl: photoUrlFor(question),
    totalQuestions,
    audioBase64: audio.toString('base64')
  });
}));

router.post('/turn', requireAuth, audioUpload.single('audio'), asyncHandler(async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId || !quizService.getSession(sessionId)) {
    return res.status(400).json({ error: 'Invalid or expired quiz session.' });
  }
  const transcript = req.file ? await sttService.transcribeAudio(req.file.buffer) : '';
  const result = quizService.submitAnswer(sessionId, transcript);

  const nextPrompt = result.sameQuestion
    ? result.feedback
    : result.done
    ? `${result.feedback} That's the end of the quiz - you got ${result.score} out of ${result.totalQuestions}. Well done for trying!`
    : `${result.feedback} ${result.nextQuestion.prompt}`;

  const audio = await ttsService.synthesizeSpeech(nextPrompt);
  const session = quizService.getSession(sessionId);
  const currentQuestion = session ? session.questions[session.index] : null;

  res.json({
    transcript,
    responseText: nextPrompt,
    photoUrl: photoUrlFor(result.sameQuestion ? currentQuestion : result.nextQuestion),
    audioBase64: audio.toString('base64'),
    done: result.done && !result.sameQuestion,
    score: result.score,
    totalQuestions: result.totalQuestions
  });
}));

module.exports = router;
