const path = require('path');
require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

const config = {
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || '0.0.0.0'
  },
  openai: {
    apiKey: required('OPENAI_API_KEY'),
    chatModel: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
    realtimeModel: process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime',
    ttsModel: process.env.OPENAI_TTS_MODEL || 'tts-1',
    ttsVoice: process.env.OPENAI_TTS_VOICE || 'coral',
    whisperModel: process.env.OPENAI_WHISPER_MODEL || 'whisper-1',
    // How loud audio must be to count as speech (0-1). Higher = ignores more background noise,
    // but can miss soft-spoken users. Lower it if quiet speakers are being ignored.
    vadThreshold: parseFloat(process.env.OPENAI_VAD_THRESHOLD || '0.75'),
    // How long a pause (ms) counts as "finished talking". Lower = snappier replies, but may
    // cut in on slow speakers who pause mid-sentence. Raise it if people get interrupted.
    vadSilenceMs: parseInt(process.env.OPENAI_VAD_SILENCE_MS || '800', 10),
    transcriptionModel: process.env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe',
    // 'far_field' suits laptop/room mics, 'near_field' suits headsets, 'off' disables it.
    noiseReduction: process.env.OPENAI_NOISE_REDUCTION || 'far_field'
  },
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    fromAddress: process.env.SMTP_FROM_ADDRESS || ''
  },
  session: {
    secret: required('SESSION_SECRET')
  },
  paths: {
    data: path.join(__dirname, '..', 'data'),
    usersFile: path.join(__dirname, '..', 'data', 'users.json'),
    profilesDir: path.join(__dirname, '..', 'data', 'profiles'),
    uploadsDir: path.join(__dirname, '..', 'data', 'uploads')
  }
};

module.exports = config;
