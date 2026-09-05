const { promptGuardScore } = require('./groq');

const GUARD_THRESHOLD = Number(process.env.AI_GUARD_THRESHOLD ?? 0.97);

async function screenMessage(text) {
  try {
    const score = await promptGuardScore(text);
    return { safe: score < GUARD_THRESHOLD, score };
  } catch (err) {
    console.warn('Prompt guard unavailable, failing open:', err.message);
    return { safe: true, score: null };
  }
}

module.exports = { screenMessage, GUARD_THRESHOLD };
