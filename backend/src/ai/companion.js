const { chatCompletion } = require('./groq');

const VOICE_PROMPT = `You are the friendly dispatcher of DevCax Logistics, chatting with truck drivers on WhatsApp.
You will be given a SITUATION (what just happened / what must be communicated) and CONTEXT (the driver's trip state).

Write ONE WhatsApp reply:
- Max 2 short sentences, under 220 characters total.
- Warm, natural, human — like a dispatcher who knows the driver. No corporate speak, no "I apologize", no "please be advised".
- Use the driver's first name at most occasionally, only when it feels natural.
- WhatsApp formatting: *bold* for job numbers.
- NEVER use emojis. NEVER use em dashes (—) or en dashes (–); use a comma, a full stop or the word "to" instead.
- Never expose internal status enum names, job ids, OCR/vision terminology or backend error text. Say "at pickup", not "ARRIVED_AT_PICKUP".
- NEVER invent facts: no new statuses, approvals, times, quantities or promises that are not in the SITUATION/CONTEXT.
- If the situation needs something from the driver, ask for it clearly and kindly.
- If the SITUATION says the driver's message was unclear or could not be matched, your reply asks them to say it again in different words. NEVER pretend an unclear message was understood, and never give trip instructions the driver did not ask for.
- OPEN JOBS in context are real and current — if the driver asks about available work, tell them how many there are and to just say "jobs" for the list. NEVER say you can't see routes or jobs when they are listed in context.
- Reply with the message text only — no quotes, no explanations.`;

function firstName(name) {
  return String(name ?? '').trim().split(/\s+/)[0] || 'there';
}

const EMOJI_PATTERN =
  /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{E0020}-\u{E007F}]/gu;

function sanitizeVoice(text) {
  return String(text ?? '')
    .replace(EMOJI_PATTERN, '')
    .replace(/[ \t]*[—–][ \t]*/g, ', ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.!?:;])/g, '$1')
    .replace(/,\s*,/g, ',')
    .replace(/,(\s*\n)/g, '$1')
    .replace(/[ \t]+$/gm, '')
    .replace(/^[ \t]+/gm, '')
    .trim();
}

async function friendlyReply({ situation, driverName, activeJob = null, activeJobSummary = null, availableJobs = [], driverMessage = null, recentMessages = [] }) {
  try {
    const context = {
      driver_first_name: firstName(driverName),
      active_job: activeJob
        ? { job_number: activeJob.job_number, status: activeJob.status, pickup: activeJob.pickup, delivery: activeJob.delivery }
        : null,
      trip_summary: activeJobSummary || null,
      open_jobs: availableJobs.map((j) => `${j.job_number} (${j.pickup ?? '?'} → ${j.delivery ?? '?'})`),
      driver_message: driverMessage,
      recent_chat: recentMessages.slice(-4).map((m) => `${m.sender}: ${m.text}`),
    };
    const text = await chatCompletion({
      messages: [
        { role: 'system', content: VOICE_PROMPT },
        { role: 'user', content: `SITUATION:\n${situation}\n\nCONTEXT:\n${JSON.stringify(context, null, 2)}\n\nWrite the reply now.` },
      ],
      temperature: 0.5,
      maxTokens: 140,
    });
    const cleaned = sanitizeVoice(
      String(text ?? '')
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .replace(/^["']|["']$/g, '')
    );
    if (!cleaned || cleaned.length > 500) return null;
    return cleaned;
  } catch (err) {
    console.warn('friendlyReply unavailable, using static fallback:', err.message);
    return null;
  }
}

module.exports = { friendlyReply, firstName, sanitizeVoice };
