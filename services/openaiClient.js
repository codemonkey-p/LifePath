const OpenAI = require('openai');
const config = require('../config');

const client = new OpenAI({ apiKey: config.openai.apiKey });

module.exports = client;
