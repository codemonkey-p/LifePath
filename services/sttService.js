const { toFile } = require('openai');
const client = require('./openaiClient');
const config = require('../config');

async function transcribeAudio(buffer, filename = 'audio.webm') {
  if (!buffer || buffer.length === 0) return '';
  const file = await toFile(buffer, filename);
  const result = await client.audio.transcriptions.create({
    file,
    model: config.openai.whisperModel
  });
  return (result.text || '').trim();
}

module.exports = { transcribeAudio };
