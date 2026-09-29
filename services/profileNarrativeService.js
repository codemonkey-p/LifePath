const fs = require('fs');
const path = require('path');
const config = require('../config');
const client = require('./openaiClient');

fs.mkdirSync(config.paths.profilesDir, { recursive: true });

function filePathFor(userId) {
  return path.join(config.paths.profilesDir, `${userId}.md`);
}

function readNarrative(userId) {
  const filePath = filePathFor(userId);
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf8');
}

function writeNarrative(userId, markdown) {
  fs.writeFileSync(filePathFor(userId), markdown, 'utf8');
}

function deleteNarrative(userId) {
  const filePath = filePathFor(userId);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

// Biography updates read-modify-write one file, so two running at once would overwrite each
// other. Chain them per user so they always apply one after another.
const updateQueues = new Map();

function foldInNewInformation(userId, preferredName, newInfoText) {
  const previous = updateQueues.get(userId) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => runFold(userId, preferredName, newInfoText));
  updateQueues.set(userId, next);
  return next;
}

async function runFold(userId, preferredName, newInfoText) {
  const current = readNarrative(userId);
  const response = await client.chat.completions.create({
    model: config.openai.chatModel,
    temperature: 0.3,
    messages: [
      {
        role: 'system',
        content:
          'You maintain a short, warm, free-flowing Markdown biography of a person for their care app. ' +
          'You will be given the current biography (may be empty) and a new piece of information learned ' +
          'about them. Rewrite the ENTIRE biography incorporating the new information naturally into ' +
          'flowing prose grouped under sensible headings (e.g. "## Family & interests", "## Health"). ' +
          'CRITICAL: only include facts that were actually stated in the current biography or the new ' +
          'information below. Never invent, assume, or pad with generic filler (no "enjoys spending time ' +
          'with loved ones" or "stays positive" style guesses unless they literally said that). If there is ' +
          "very little to say, write very little - a single short sentence is fine and better than padding. " +
          'Attribute every fact to exactly the person it was stated about: a relative\'s birthday or details ' +
          "belong to that relative and must never be moved onto the main person. " +
          'Never record specific medications, doses or medication times in the biography - those are kept in a ' +
          'separate saved list - and if the current biography mentions any, remove them. ' +
          "Do not include a raw transcript or Q&A format - write it as a biography. " +
          `Start with a "# About ${preferredName || 'this person'}" heading. Keep it concise.`
      },
      {
        role: 'user',
        content: `CURRENT BIOGRAPHY:\n${current || '(empty so far)'}\n\nNEW INFORMATION LEARNED:\n${newInfoText}`
      }
    ]
  });
  const updated = response.choices[0].message.content.trim();
  writeNarrative(userId, updated);
  return updated;
}

module.exports = { readNarrative, writeNarrative, deleteNarrative, foldInNewInformation };
