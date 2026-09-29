const client = require('./openaiClient');
const config = require('../config');

async function synthesizeSpeech(text) {
  const response = await client.audio.speech.create({
    model: config.openai.ttsModel,
    voice: config.openai.ttsVoice,
    input: text
  });
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = { synthesizeSpeech };
