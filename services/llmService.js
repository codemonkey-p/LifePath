const client = require('./openaiClient');
const config = require('../config');

const NATURAL_TONE_INSTRUCTION =
  'Speak warmly and naturally, like a caring person having a real conversation - use contractions, ' +
  'vary your wording, and never sound clinical or robotic. Keep replies short (1-3 sentences) since they ' +
  'will be read aloud to someone who may have memory or attention difficulty. Never repeat a question ' +
  "word-for-word if you're revisiting a topic - rephrase it naturally instead. Never sound harsh or " +
  'make the person feel wrong; always be encouraging.';

async function chat({ systemPrompt, messages, tools, temperature = 0.8 }) {
  const response = await client.chat.completions.create({
    model: config.openai.chatModel,
    temperature,
    messages: [
      { role: 'system', content: `${systemPrompt}\n\n${NATURAL_TONE_INSTRUCTION}` },
      ...messages
    ],
    tools,
    tool_choice: tools ? 'auto' : undefined
  });
  return response.choices[0].message;
}

async function extractStructured({ instruction, text, schemaDescription }) {
  const response = await client.chat.completions.create({
    model: config.openai.chatModel,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          `${instruction}\nRespond with ONLY a JSON object matching this shape: ${schemaDescription}\n` +
          'If a value was not actually mentioned, use null (or an empty array for list fields). Do not guess.'
      },
      { role: 'user', content: text }
    ]
  });
  try {
    return JSON.parse(response.choices[0].message.content);
  } catch (err) {
    return null;
  }
}

module.exports = { chat, extractStructured, NATURAL_TONE_INSTRUCTION };
