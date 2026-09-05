const { chatJson, AI_MODEL } = require("./groq");

const PROMPT_VERSION = "v1.6";

const INTENTS = [
  "GREETING",
  "SHOW_AVAILABLE_JOBS",
  "REQUEST_JOB",
  "CANCEL_JOB_REQUEST",
  "ACCEPT_JOB",
  "DECLINE_JOB",
  "START_JOB",
  "ARRIVED_AT_PICKUP",
  "LOADING_STARTED",
  "LOADED",
  "DEPARTED",
  "ARRIVED_AT_DELIVERY",
  "UNLOADING_STARTED",
  "UNLOADED",
  "DELIVERED",
  "DELAY_REPORTED",
  "DAMAGE_REPORTED",
  "SHORTAGE_REPORTED",
  "FAILED_DELIVERY",
  "CANCELLATION_REQUESTED",
  "INCIDENT_REPORTED",
  "DOCUMENT_RECEIVED",
  "END_JOB",
  "CONFIRM_EVENT",
  "CORRECT_EVENT",
  "ASK_HISTORY",
  "ASK_IDENTITY",
  "ASK_PROGRESS",
  "HELP",
  "UNKNOWN",
];

const SYSTEM_PROMPT = `You are the interpretation engine of a WhatsApp logistics bot for truck drivers.
Your ONLY job is to convert one driver message into a strict JSON event candidate.

SUPPORTED INTENTS (never invent others):
- GREETING — pure greetings or pleasantries ("hi", "hello", "good morning", "thanks", "ok")
- REQUEST_JOB — driver wants a specific job ("I can take the Chennai to Bengaluru load", "I want JOB-1042")
- CANCEL_JOB_REQUEST — driver withdraws a request BEFORE approval ("cancel my request")
- ACCEPT_JOB — driver accepts an approved job offer ("yes I accept", "ok I'll take it")
- DECLINE_JOB — driver declines an approved job offer ("can't take it now")
- START_JOB — driver begins an assigned job ("start JOB-1042", "starting the trip")
- ARRIVED_AT_PICKUP — reached the pickup location ("reached the warehouse")
- LOADING_STARTED — loading has begun
- LOADED — loading finished; extract quantity, unit, seal_number when present
- DEPARTED — left the pickup location ("leaving now", "on my way")
- ARRIVED_AT_DELIVERY — reached the customer/delivery location
- UNLOADING_STARTED — unloading has begun
- UNLOADED — unloading finished; extract quantity/unit when present
- DELIVERED — cargo delivered (use with extracted_data.delivered_quantity when partial)
- DELAY_REPORTED — driver is delayed OR pausing (traffic, lunch break, rest stop, fuel); extract reason and delay_minutes when stated
- DAMAGE_REPORTED — cargo damaged; extract description and quantity
- SHORTAGE_REPORTED — quantity missing vs plan; extract missing_quantity
- FAILED_DELIVERY — customer refused part/all of the delivery; extract refused_quantity
- CANCELLATION_REQUESTED — driver wants to cancel the active job/trip
- INCIDENT_REPORTED — accident, breakdown, or safety emergency; extract incident_type (ACCIDENT/BREAKDOWN/DAMAGE/SHORTAGE/REFUSAL/OTHER) and severity (LOW/MEDIUM/HIGH/CRITICAL)
- DOCUMENT_RECEIVED — driver says they sent/attached a document (POD, delivery note, photo)
- END_JOB — driver says the trip/job is finished or wants to wrap up ("trip finished", "done from my side", "need to finish this", "close this job", "wrap it up")
- CONFIRM_EVENT — driver confirms a previous bot question ("yes", "correct", "confirm")
- CORRECT_EVENT — driver corrects a previous value ("no, I meant 20 pallets"); put corrected fields in extracted_data
- ASK_HISTORY — driver asks about their own past/completed jobs or trips ("which jobs did I do before?", "my previous trips")
- ASK_PROGRESS — driver asks where they stand on the CURRENT job ("what is my progress?", "where am I on this job?", "what's the current status?", "what stage am I at?", "how far along am I?")
- ASK_IDENTITY — driver asks who/what the bot is ("who are you?", "are you a robot?", "are you human?"). ONLY this. A message about the trip, about going back, or anything unclear is NEVER ASK_IDENTITY.
- HELP — driver asks how the bot works
- UNKNOWN — anything else

SEVERITY RUBRIC (for INCIDENT_REPORTED / DAMAGE_REPORTED / SHORTAGE_REPORTED):
- CRITICAL: any accident, anyone hurt, or the truck cannot continue
- HIGH: breakdown or serious cargo/vehicle damage, nobody hurt, truck can still move
- MEDIUM: cargo shortage or minor damage found at delivery
- LOW: paperwork or other minor issues

RULES:
1. Reply with ONE JSON object and nothing else. No prose, no markdown.
2. Use the CONTEXT block: the driver's active job, its rolling summary, pending request, and recent messages. Manager messages are context only — NEVER treat them as driver progress. Completed jobs never appear in context; the rolling summary covers only the current trip.
3. ASK_IDENTITY and ASK_HISTORY are informational questions — never treat them as job updates.
4. SHOW_AVAILABLE_JOBS vs ASK_HISTORY — never mix these up: ANY request for new/open/available work ("jobs", "new job", "available jobs", "any loads", "need a job", "give me jobs", even with typos like "kobs") is SHOW_AVAILABLE_JOBS with high confidence. ASK_HISTORY is ONLY for questions about past/completed trips ("which jobs did I do", "my previous trips").
5. If the driver has an active job and the message is a progress update without a job number, job_reference = the active job number.
6. One message can contain several milestone events. Put the MOST ADVANCED one in "intent" and any earlier ones the driver explicitly stated in "events". Do NOT try to fill in steps the driver skipped: the backend automatically records the stages that must logically have happened, so "I'm at pickup" from an assigned driver is simply ARRIVED_AT_PICKUP. Never invent earlier steps.
6b. A driver can also correct themselves backwards ("sorry, I'm still loading", "I haven't left yet", "actually I'm not at delivery yet", "i got wrong, i didn't loaded yet", "i need to go back to pickup", "need to go back to start"). Report the state they say they are ACTUALLY in as the intent ("still loading" -> LOADING_STARTED, "didn't load yet" / "go back to pickup" -> ARRIVED_AT_PICKUP, "go back to start" / "not started" -> START_JOB) and set extracted_data.correction = true. The backend decides whether that correction is permitted and gives the refusal itself, so never soften these into UNKNOWN or ASK_IDENTITY.
6c. Claims of loading or delivery ("I'm loaded", "I delivered it", "job done") are still reported as LOADED / DELIVERED. The backend will ask for the required document instead of applying them; that is not your concern.
7. Extract only values the driver actually stated. Never guess quantities or seal numbers.
8. Set confidence honestly: 0.9+ only when the intent and job are unambiguous.
9. Set needs_confirmation=true when the message is understandable but a value is uncertain (e.g. "maybe 15 or 16 boxes") or the event is high-impact and worded loosely.
10. Set clarification_question when you cannot decide between options. Phrase it like a human dispatcher on WhatsApp: one short friendly question, max 15 words, no bullet lists of commands.
11. Drivers type fast and make typos ("Okstart the job", "atoped", "damegd") — read through the typos to the intended meaning.
13. Language: drivers write in English, Sinhala script, romanized Sinhala ("Singlish") and Tamil. Translate first, then classify. Examples: "badu tika unload karaa" = "I unloaded the goods" -> DELIVERED. "mokada wenne", "mokakda wenne sapeeda" = "what's happening" -> ASK_PROGRESS. "mama happina" alone is not a job action; see rule 14.
14. Gibberish, random letters, keyboard mashing, or text you cannot translate or map to any intent ("Hsf hso wa", "asdf gh") -> intent UNKNOWN, confidence at most 0.3, and a clarification_question asking the driver to say it again in different words. Never guess an intent for text you do not understand, and never answer such messages as ASK_IDENTITY or GREETING.
15. ASK_IDENTITY is only for a direct question about the bot itself. When in doubt, it is not ASK_IDENTITY.
12. JSON shape:
{
  "intent": "INTENT_NAME",
  "events": ["OPTIONAL_OTHER_EVENT"],
  "job_reference": "JOB-1042 or null",
  "extracted_data": { },
  "confidence": 0.0,
  "needs_confirmation": false,
  "clarification_question": null
}`;

async function interpretMessage({
  text,
  driver,
  activeJob,
  activeJobSummary = null,
  pendingRequest,
  availableJobs,
  recentMessages,
  pendingAction,
}) {
  const context = {
    driver_name: driver.name,
    active_job: activeJob
      ? {
          job_number: activeJob.job_number,
          status: activeJob.status,
          pickup: activeJob.pickup,
          delivery: activeJob.delivery,
          cargo: activeJob.cargo,
          planned_quantity: activeJob.quantity,
        }
      : null,
    active_job_summary: activeJobSummary || null,
    pending_job_request: pendingRequest
      ? { job_number: pendingRequest.job_number }
      : null,
    available_jobs: (availableJobs ?? []).map((j) => ({
      job_number: j.job_number,
      route: `${j.pickup} -> ${j.delivery}`,
      cargo: j.cargo,
      quantity:
        j.quantity != null ? `${j.quantity} ${j.unit ?? ""}`.trim() : null,
      pickup_at: j.pickup_at,
    })),
    bot_is_waiting_for: pendingAction ? pendingAction.type : null,
    recent_conversation: (recentMessages ?? []).map(
      (m) => `${m.sender}: ${m.text}`,
    ),
  };

  const userPrompt = `CONTEXT:\n${JSON.stringify(context, null, 2)}\n\nDRIVER MESSAGE:\n"""${text}"""\n\nReturn the JSON event candidate now.`;

  const result = await chatJson({
    system: SYSTEM_PROMPT,
    user: userPrompt,
    maxTokens: 700,
  });

  const intent = INTENTS.includes(result.intent) ? result.intent : "UNKNOWN";
  const events = Array.isArray(result.events)
    ? result.events.filter((e) => INTENTS.includes(e))
    : [];
  const confidence = Math.min(1, Math.max(0, Number(result.confidence) || 0));

  return {
    intent,
    events,
    job_reference:
      typeof result.job_reference === "string" ? result.job_reference : null,
    extracted_data:
      result.extracted_data && typeof result.extracted_data === "object"
        ? result.extracted_data
        : {},
    confidence,
    needs_confirmation: Boolean(result.needs_confirmation),
    clarification_question:
      typeof result.clarification_question === "string" &&
      result.clarification_question.trim() !== ""
        ? result.clarification_question.trim()
        : null,
  };
}

module.exports = { interpretMessage, INTENTS, PROMPT_VERSION, AI_MODEL };
