const GROQ_BASE_URL =
  process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";
const AI_MODEL = process.env.AI_MODEL || "qwen/qwen3.8-27b";
const AI_GUARD_MODEL =
  process.env.AI_GUARD_MODEL || "meta-llama/llama-prompt-guard-2-86m";
const AI_WHISPER_MODEL = process.env.AI_WHISPER_MODEL || "whisper-large-v3";
const AI_VISION_MODEL = process.env.AI_VISION_MODEL || "";

const AI_VISION_BASE_URL = process.env.AI_VISION_BASE_URL || GROQ_BASE_URL;
const AI_VISION_API_KEY = process.env.AI_VISION_API_KEY || "";

function apiKey() {
  const key = process.env.GROQ_API;
  if (!key) throw new Error("GROQ_API is not configured in backend/.env");
  return key;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MAX_ATTEMPTS = 4;
const isRetryable = (status) => status === 429 || status >= 500;

async function chatCompletion({
  model = AI_MODEL,
  messages,
  temperature = 0,
  maxTokens = 900,
  json = false,
  baseUrl = GROQ_BASE_URL,
  key = null,
}) {
  const body = {
    model,
    messages,
    temperature,
    max_completion_tokens: maxTokens,
  };
  if (json) body.response_format = { type: "json_object" };

  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key || apiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok) return data?.choices?.[0]?.message?.content ?? "";
    if (!isRetryable(res.status) || attempt === MAX_ATTEMPTS) {
      throw new Error(
        `Groq chat failed (${res.status}): ${JSON.stringify(data.error ?? data)}`,
      );
    }
    const wait = retryDelayMs(data, attempt);
    console.warn(
      `Groq chat ${res.status} for ${model} — retry ${attempt}/${MAX_ATTEMPTS - 1} in ${wait}ms`,
    );
    await sleep(wait);
  }
}

async function chatJson({
  system,
  user,
  model = AI_MODEL,
  temperature = 0,
  maxTokens = 900,
}) {
  const raw = await chatCompletion({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature,
    maxTokens,
    json: true,
  });

  const cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/```(?:json)?/gi, "")
    .trim();

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Groq returned non-JSON output: ${raw.slice(0, 200)}`);
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function promptGuardScore(text) {
  const raw = await chatCompletion({
    model: AI_GUARD_MODEL,
    messages: [{ role: "user", content: text.slice(0, 1500) }],
    temperature: 0,
    maxTokens: 20,
  });
  const score = Number.parseFloat(raw.trim());
  if (Number.isNaN(score)) {
    return /unsafe|malicious|injection/i.test(raw) ? 1 : 0;
  }
  return score;
}

async function transcribeAudio(audioBuffer, filename = "voice.ogg") {
  const form = new FormData();
  form.append("file", new Blob([audioBuffer]), filename);
  form.append("model", AI_WHISPER_MODEL);
  form.append("response_format", "json");

  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${GROQ_BASE_URL}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey()}` },
      body: form,
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok) return { text: data.text ?? "" };
    if (!isRetryable(res.status) || attempt === MAX_ATTEMPTS) {
      throw new Error(
        `Groq transcription failed (${res.status}): ${JSON.stringify(data.error ?? data)}`,
      );
    }
    const wait = retryDelayMs(data, attempt);
    console.warn(
      `Groq transcription ${res.status} — retry ${attempt}/${MAX_ATTEMPTS - 1} in ${wait}ms`,
    );
    await sleep(wait);
  }
}

async function chatVision({
  system,
  imageBase64,
  mimeType = "image/jpeg",
  caption = null,
  maxTokens = 500,
  throwOnError = false,
}) {
  if (!AI_VISION_MODEL) {
    if (throwOnError) throw new Error("AI_VISION_MODEL is not configured");
    return null;
  }
  try {
    const raw = await chatCompletion({
      model: AI_VISION_MODEL,
      baseUrl: AI_VISION_BASE_URL,
      key: AI_VISION_API_KEY || null,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: caption
                ? `Driver's caption: ${caption}`
                : "Analyze this image.",
            },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${imageBase64}` },
            },
          ],
        },
      ],
      temperature: 0,
      maxTokens,
      json: true,
    });
    const cleaned = raw.replace(/```(?:json)?/gi, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      if (throwOnError)
        throw new Error(
          `Vision model returned non-JSON output: ${raw.slice(0, 200)}`,
        );
      return null;
    }
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (err) {
    console.error("Vision analysis failed:", err.message);
    if (throwOnError) throw err;
    return null;
  }
}

module.exports = {
  chatCompletion,
  chatJson,
  chatVision,
  promptGuardScore,
  transcribeAudio,
  AI_MODEL,
  AI_GUARD_MODEL,
  AI_WHISPER_MODEL,
  AI_VISION_MODEL,
  AI_VISION_BASE_URL,
};
