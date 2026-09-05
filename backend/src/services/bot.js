const { pool } = require("../db");
const whatsapp = require("../whatsapp");
const { screenMessage } = require("../ai/promptGuard");
const {
  interpretMessage,
  PROMPT_VERSION,
  AI_MODEL,
} = require("../ai/interpreter");
const { transcribeAudio } = require("../ai/groq");
const vision = require("../ai/vision");
const documentCode = require("../ai/documentCode");
const { friendlyReply, firstName, sanitizeVoice } = require("../ai/companion");
const { formatWhen } = require("../time");
const workflow = require("./workflow");
const summarizer = require("./summarizer");
const vehicleMatch = require("../ai/vehicleMatch");

const AUTO_APPLY_MIN = Number(process.env.AI_AUTO_APPLY_MIN ?? 0.85);
const CLARIFY_MIN = Number(process.env.AI_CLARIFY_MIN ?? 0.6);

const MILESTONE_SET = new Set(workflow.MILESTONE_EVENTS);

const STATE_CHANGING = new Set([
  "REQUEST_JOB",
  "CANCEL_JOB_REQUEST",
  "ACCEPT_JOB",
  "DECLINE_JOB",
  "START_JOB",
  ...workflow.MILESTONE_EVENTS,
  "END_JOB",
]);

async function getPendingAction(conversationId) {
  const r = await pool.query(
    "SELECT pending_action FROM conversations WHERE id = $1",
    [conversationId],
  );
  return r.rows[0]?.pending_action ?? null;
}

async function setPendingAction(conversationId, action) {
  await pool.query(
    "UPDATE conversations SET pending_action = $2 WHERE id = $1",
    [
      conversationId,
      JSON.stringify({ ...action, created_at: new Date().toISOString() }),
    ],
  );
}

async function clearPendingAction(conversationId) {
  await pool.query(
    "UPDATE conversations SET pending_action = NULL WHERE id = $1",
    [conversationId],
  );
}

async function quotedApplyInviteJobId(conversationId, replyToMessageId) {
  if (!replyToMessageId) return null;

  const message = await pool.query(
    `SELECT body_text
       FROM messages
      WHERE conversation_id = $1
        AND external_message_id = $2
        AND sender_type = 'BOT'
      LIMIT 1`,
    [conversationId, replyToMessageId],
  );
  const body = message.rows[0]?.body_text ?? '';
  if (!/tap\s+apply\s+now/i.test(body)) return null;

  const jobNumber = body.match(/\bJOB-[A-Z0-9-]+\b/i)?.[0];
  if (!jobNumber) return null;

  const job = await pool.query(
    `SELECT j.id
       FROM jobs j
       JOIN conversations c ON c.organization_id = j.organization_id
      WHERE c.id = $1
        AND upper(j.job_number) = upper($2)
      LIMIT 1`,
    [conversationId, jobNumber],
  );
  return job.rows[0]?.id ?? null;
}

async function isAiPaused(conversationId) {
  const result = await pool.query(
    "SELECT ai_paused_at IS NOT NULL AS ai_paused FROM conversations WHERE id = $1",
    [conversationId],
  );
  return result.rows[0]?.ai_paused === true;
}

async function reply({
  conversationId,
  phone,
  body,
  buttons = null,
  listRows = null,
}) {
  const text = sanitizeVoice(body);
  const cleanButtons = buttons
    ? buttons.map((b) => ({ ...b, title: sanitizeVoice(b.title) }))
    : null;
  const cleanRows = listRows
    ? listRows.map((r) => ({
        ...r,
        title: sanitizeVoice(r.title),
        ...(r.description ? { description: sanitizeVoice(r.description) } : {}),
      }))
    : null;

  const inserted = await pool.query(
    `INSERT INTO messages (conversation_id, sender_type, message_type, source_type, body_text, delivery_status, sent_at)
     VALUES ($1, 'BOT', $2, 'BOT_MESSAGE', $3, 'QUEUED', now())
     RETURNING id`,
    [conversationId, cleanButtons || cleanRows ? "BUTTON" : "TEXT", text],
  );
  const messageId = inserted.rows[0].id;

  try {
    let wamid;
    if (cleanButtons)
      wamid = await whatsapp.sendInteractiveButtons(phone, text, cleanButtons);
    else if (cleanRows)
      wamid = await whatsapp.sendInteractiveList(
        phone,
        text,
        "Choose",
        cleanRows,
      );
    else wamid = await whatsapp.sendTextMessage(phone, text);

    await pool.query(
      `UPDATE messages SET delivery_status = 'SENT', external_message_id = COALESCE($2, external_message_id) WHERE id = $1`,
      [messageId, wamid],
    );
  } catch (err) {
    await pool.query(
      `UPDATE messages SET delivery_status = 'FAILED' WHERE id = $1`,
      [messageId],
    );
    console.error(`Bot reply ${messageId} failed to send:`, err.message);
  }

  await pool.query(
    "UPDATE conversations SET last_message_at = now() WHERE id = $1",
    [conversationId],
  );
  return messageId;
}

async function storeInterpretation(
  messageId,
  candidate,
  processingStatus,
  errorMessage = null,
) {
  await pool.query(
    `INSERT INTO ai_interpretations (message_id, model_name, prompt_version, primary_intent, structured_output, confidence_score, processing_status, error_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (message_id) DO NOTHING`,
    [
      messageId,
      AI_MODEL,
      PROMPT_VERSION,
      candidate.intent,
      JSON.stringify(candidate),
      candidate.confidence ?? null,
      processingStatus,
      errorMessage,
    ],
  );
}

async function loadInterpreterContext(driver, conversationId) {
  const assignment = await workflow.getDriverAssignment(pool, driver.id);

  let activeJob = null;
  let activeJobSummary = null;
  if (assignment) {
    const r = await pool.query(
      `SELECT j.job_number, j.current_status AS status, j.cargo_description AS cargo,
              pl.name AS pickup, dl.name AS delivery,
              ji.planned_quantity AS quantity, ji.unit
         FROM jobs j
         LEFT JOIN job_stops ps ON ps.job_id = j.id AND ps.stop_type = 'PICKUP'
         LEFT JOIN locations pl ON pl.id = ps.location_id
         LEFT JOIN job_stops ds ON ds.job_id = j.id AND ds.stop_type = 'DELIVERY'
         LEFT JOIN locations dl ON dl.id = ds.location_id
         LEFT JOIN job_items ji ON ji.job_id = j.id
        WHERE j.id = $1 LIMIT 1`,
      [assignment.job_id],
    );
    activeJob = r.rows[0] ?? null;

    const sR = await pool.query(
      "SELECT summary_text FROM job_summaries WHERE job_id = $1",
      [assignment.job_id],
    );
    activeJobSummary = sR.rows[0]?.summary_text || null;
  }

  const pendingRequest = await workflow.getPendingRequest(driver);
  const availableJobs = assignment
    ? []
    : await workflow.listAvailableJobs(driver);

  const recent = await pool.query(
    `SELECT sender_type, body_text FROM messages
      WHERE conversation_id = $1 AND message_type IN ('TEXT', 'BUTTON')
      ORDER BY created_at DESC LIMIT 6`,
    [conversationId],
  );
  const recentMessages = recent.rows.reverse().map((m) => ({
    sender: m.sender_type,
    text: (m.body_text ?? "").slice(0, 160),
  }));

  const pendingAction = await getPendingAction(conversationId);
  return {
    activeJob,
    activeJobSummary,
    pendingRequest,
    availableJobs,
    recentMessages,
    pendingAction,
  };
}

function fmtJobLine(j) {
  const qty =
    j.quantity != null ? `, ${j.quantity} ${j.unit ?? ""}`.trimEnd() : "";
  return `*${j.job_number}*: ${j.pickup ?? "?"} → ${j.delivery ?? "?"}${qty}`;
}

function joinList(items) {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function verifiedDocumentReply(stage, result) {
  const codeWord = stage === "PICKUP" ? "Pickup" : "Delivery";
  if (result.alreadyVerified || result.noop) {
    return stage === "PICKUP"
      ? `${codeWord} code already verified. The job is still marked as loaded, nothing changed.`
      : `${codeWord} code already verified. The job is still marked as delivered. Send it for closure whenever you are ready and the manager will approve it.`;
  }

  const stages = (result.applied ?? []).map((state) =>
    workflow.stateMachine.label(state),
  );
  const listed =
    stages.length > 1
      ? `I marked the job as ${joinList(stages)}.`
      : `I marked the job as ${stages[0] ?? workflow.stateMachine.label(result.newStatus)}.`;
  const tail =
    stage === "DELIVERY"
      ? " The delivery is complete. Send the job for closure when you are ready, and the manager will approve it."
      : "";
  return `${codeWord} code verified. ${listed}${tail}`;
}

function candidateSummary(candidate, jobNumber) {
  const data = candidate.extracted_data ?? {};
  const parts = [];
  if (MILESTONE_SET.has(candidate.intent)) {
    parts.push(
      `Mark *${jobNumber ?? "your job"}* as *${MILESTONE_LABEL[candidate.intent]}*`,
    );
  } else {
    parts.push(
      `Apply *${candidate.intent.replace(/_/g, " ").toLowerCase()}*${jobNumber ? ` on *${jobNumber}*` : ""}`,
    );
  }

  const details = [];
  if (data.quantity != null)
    details.push(`quantity ${data.quantity} ${data.unit ?? ""}`.trimEnd());
  if (data.delivered_quantity != null)
    details.push(`delivered ${data.delivered_quantity}`);
  if (data.refused_quantity != null)
    details.push(`refused ${data.refused_quantity}`);
  if (data.damaged_quantity != null)
    details.push(`damaged ${data.damaged_quantity}`);
  if (data.shortage_quantity != null)
    details.push(`short ${data.shortage_quantity}`);
  if (data.seal_number) details.push(`seal ${data.seal_number}`);
  if (data.delay_minutes != null) details.push(`~${data.delay_minutes} min`);
  if (data.reason) details.push(`reason: ${data.reason}`);
  if (details.length > 0) parts.push(`(${details.join(", ")})`);
  return parts.join(" ");
}

function jobChoiceRows(jobs) {
  return jobs.map((j) => ({
    id: `CHOOSE_JOB:${j.id}`,
    title: j.job_number,
    description:
      `${j.pickup ?? "?"} → ${j.delivery ?? "?"}${j.quantity != null ? ` · ${j.quantity} ${j.unit ?? ""}` : ""}`.slice(
        0,
        72,
      ),
  }));
}

const MILESTONE_LABEL = {
  ARRIVED_AT_PICKUP: "arrived at pickup",
  LOADING_STARTED: "loading started",
  LOADED: "loaded",
  DEPARTED: "departed",
  ARRIVED_AT_DELIVERY: "arrived at delivery",
  UNLOADING_STARTED: "unloading started",
  UNLOADED: "unloaded",
  DELIVERED: "delivered",
};

const POD_PATTERN = /\b(pod|proof of delivery|delivery note|signed pod|grn)\b/i;

async function transcribeVoiceMessage(messageId) {
  const att = await pool.query(
    `SELECT id, storage_key, mime_type, transcription_text FROM attachments
      WHERE message_id = $1 AND attachment_type = 'AUDIO'
      ORDER BY created_at DESC LIMIT 1`,
    [messageId],
  );
  const attachment = att.rows[0];
  if (!attachment) return null;

  let transcript = (attachment.transcription_text ?? "").trim();
  if (!transcript) {
    try {
      const { buffer, mimeType } = await whatsapp.downloadMedia(
        attachment.storage_key,
      );
      const ext = (mimeType.split("/")[1] ?? "ogg").split(";")[0];
      const result = await transcribeAudio(buffer, `voice.${ext}`);
      transcript = (result.text ?? "").trim();
    } catch (err) {
      console.error("Voice transcription failed:", err.message);
      return null;
    }
  }
  if (!transcript) return null;

  await pool.query(
    "UPDATE attachments SET transcription_text = $2 WHERE id = $1",
    [attachment.id, transcript],
  );
  await pool.query("UPDATE messages SET body_text = $2 WHERE id = $1", [
    messageId,
    ` ${transcript}`,
  ]);
  return transcript;
}

async function prepareDocumentContext(ctx, caption) {
  const { d, messageId, conversationId } = ctx;
  const att = await pool.query(
    `SELECT id, attachment_type, original_filename FROM attachments WHERE message_id = $1 ORDER BY created_at`,
    [messageId],
  );
  if (att.rows.length === 0) return null;

  const attachmentIds = att.rows.map((a) => a.id);
  const filenames = att.rows.map((a) => a.original_filename ?? "").join(" ");
  const documentType = POD_PATTERN.test(`${caption ?? ""} ${filenames}`)
    ? "POD"
    : "OTHER";

  const assignment = await workflow.getDriverAssignment(pool, d.id);
  if (!assignment) {
    const jobs = await workflow.listRecentJobsForDriver(d);
    if (jobs.length === 0) {
      return {
        linked: false,
        confirmation:
          "Got the document, you don't have a job to attach it to right now, but the manager can still see it here.",
      };
    }
    await setPendingAction(conversationId, {
      type: "AWAITING_DOC_JOB_CHOICE",
      messageId,
      attachmentIds,
      documentType,
      caption,
    });
    return {
      needsJobChoice: true,
      jobRows: jobs.map((j) => ({
        id: `DOC_JOB:${j.id}`,
        title: j.job_number,
        description:
          `${j.pickup ?? "?"} → ${j.delivery ?? "?"} · ${j.current_status.replace(/_/g, " ")}`.slice(
            0,
            72,
          ),
      })),
    };
  }

  const { job } = await workflow.attachDocuments(d, {
    attachmentIds,
    documentType,
    caption,
    messageId,
    confidence: 1,
  });
  const confirmation =
    documentType === "POD"
      ? `POD received and attached to *${job.job_number}*. The manager can see it on the job timeline.`
      : `Document attached to *${job.job_number}*. The manager can see it on the job timeline.`;
  return {
    linked: true,
    job,
    documentType,
    attachmentIds,
    caption,
    confirmation,
  };
}

async function handleInboundImage(ctx, caption) {
  const { d, messageId } = ctx;
  const att = await pool.query(
    `SELECT id, public_url FROM attachments
      WHERE message_id = $1 AND attachment_type IN ('IMAGE', 'DOCUMENT')
      ORDER BY created_at LIMIT 1`,
    [messageId],
  );
  const attachment = att.rows[0];
  if (!attachment) return null;

  const imageUrl = attachment.public_url ?? null;
  const visionResult = await vision.analyzeAttachment(attachment.id, caption);

  if (!visionResult) {
    const stageDoc = await handleStageDocument(ctx, {
      attachment,
      imageUrl,
      stage: null,
      caption,
    });
    return stageDoc;
  }

  if (["ACCIDENT", "BREAKDOWN", "DAMAGE"].includes(visionResult.scene_class)) {
    const assignment = await workflow.getDriverAssignment(pool, d.id);
    if (!assignment || assignment.status !== "ACTIVE") return null;
    const { job, incidentId, incidentType, severity, alreadyReported } =
      await workflow.reportIncident(d, {
        incidentType: visionResult.scene_class,
        severity: visionResult.severity_hint,
        description:
          visionResult.description ||
          `${visionResult.scene_class} detected in driver photo`,
        data: { source: "VISION" },
        messageId,
        confidence: 1,
        imageUrl,
      });
    await pool.query(
      `INSERT INTO incident_attachments (incident_id, attachment_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [incidentId, attachment.id],
    );
    const emergency =
      severity === "CRITICAL"
        ? " If anyone is hurt or in danger, call emergency services first."
        : "";
    return await reply({
      ...ctx,
      body: alreadyReported
        ? `I added that photo to the existing ${incidentType.toLowerCase()} report for *${job.job_number}*.${emergency} Tell me what changed, and share your location here if you need help.`
        : `I saw that photo, I've logged a ${incidentType.toLowerCase()} report on *${job.job_number}* and alerted the manager (severity ${severity}).${emergency} Tell me what happened, and if you can, share your location here so we can get help to you faster.`,
    });
  }

  const detectedCodes = Array.isArray(visionResult.detected_codes)
    ? visionResult.detected_codes
        .map((code) => String(code).trim().toUpperCase())
        .filter(Boolean)
    : [];
  const documentScene = ["PICKUP_PAPER", "DELIVERY_PAPER", "POD"].includes(
    visionResult.scene_class,
  );
  let initialExtraction =
    detectedCodes.length > 0
      ? {
          outcome: documentCode.OUTCOME.OK,
          codes: detectedCodes,
          jobNumber: visionResult.detected_job_number ?? null,
          notes: null,
          error: null,
        }
      : null;

  if (!documentScene && !initialExtraction) {
    const codeExtraction = await documentCode.extractDocumentCodes(
      attachment.id,
      caption,
    );
    if (codeExtraction.outcome === documentCode.OUTCOME.OK)
      initialExtraction = codeExtraction;
  }

  if (documentScene || initialExtraction) {
    return await handleStageDocument(ctx, {
      attachment,
      imageUrl,
      stage:
        visionResult.scene_class === "PICKUP_PAPER" ? "PICKUP" : "DELIVERY",
      caption,
      initialExtraction,
    });
  }

  return null;
}

async function handleStageDocument(
  ctx,
  {
    attachment,
    imageUrl,
    stage: hintedStage,
    caption,
    initialExtraction = null,
  },
) {
  const { d, messageId } = ctx;

  const assignment = await workflow.getDriverAssignment(pool, d.id);
  if (!assignment) return null;

  const job = (
    await pool.query(
      `SELECT id, job_number, current_status, pickup_code, delivery_code,
            pickup_verified_at, delivery_verified_at
       FROM jobs WHERE id = $1`,
      [assignment.job_id],
    )
  ).rows[0];
  if (!job) return null;

  let stage = resolveDocumentStage(job, hintedStage);
  const extraction =
    initialExtraction ??
    (await documentCode.extractDocumentCodes(attachment.id, caption));

  if (extraction.outcome === documentCode.OUTCOME.TECH_FAIL) {
    console.error(
      `Document code extraction failed for ${job.job_number}:`,
      extraction.error,
    );
    await workflow.recordEvent(pool, {
      jobId: job.id,
      messageId,
      eventType: "DOCUMENT_VERIFICATION_FAILED",
      status: "REVIEW_REQUIRED",
      data: { stage, attachment_id: attachment.id, failure: "TECHNICAL" },
    });
    return await reply({
      ...ctx,
      body: `I couldn't process the ${stage.toLowerCase()} document because of a technical issue on my side. Please try uploading it again.`,
    });
  }

  if (extraction.outcome === documentCode.OUTCOME.UNCLEAR) {
    await workflow.recordEvent(pool, {
      jobId: job.id,
      messageId,
      eventType: "DOCUMENT_VERIFICATION_FAILED",
      status: "REVIEW_REQUIRED",
      data: {
        stage,
        attachment_id: attachment.id,
        failure: "UNREADABLE",
        notes: extraction.notes,
      },
    });
    return await reply({
      ...ctx,
      body: `I couldn't clearly read the ${stage.toLowerCase()} code from this image. Please upload a clearer photo showing the full code.`,
    });
  }

  stage = resolveDocumentStage(job, hintedStage, extraction);
  const expectedCode = stage === "PICKUP" ? job.pickup_code : job.delivery_code;
  if (!expectedCode) return null;

  if (stage === "DELIVERY" && !job.pickup_verified_at) {
    await workflow.recordEvent(pool, {
      jobId: job.id,
      messageId,
      eventType: "DOCUMENT_VERIFICATION_FAILED",
      status: "REVIEW_REQUIRED",
      data: {
        stage,
        attachment_id: attachment.id,
        failure: "PICKUP_REQUIRED_FIRST",
      },
    });
    return await reply({
      ...ctx,
      body: `I recognized the delivery code for *${job.job_number}*, but the pickup document must be verified first. Send the pickup-code photo, then send this delivery-code photo again after the job is loaded.`,
    });
  }

  const result = await workflow.verifyDocument(d, {
    jobId: job.id,
    stage,
    extraction,
    attachmentId: attachment.id,
    messageId,
    imageUrl,
  });

  if (!result.verified) {
    return await reply({
      ...ctx,
      body: `The ${stage.toLowerCase()} code on that document does not match the code recorded for this job, so I have not changed the job status. Please upload the correct ${stage.toLowerCase()} document.`,
    });
  }

  if (result.needsStartConfirmation) {
    await setPendingAction(ctx.conversationId, {
      type: "AWAITING_START_CONFIRM",
      candidate: null,
    });
    return await reply({
      ...ctx,
      body: `Your ${stage.toLowerCase()} document is verified and safely stored, so you will not need to upload it again. *${job.job_number}* has not been marked as started yet though, and I cannot move it forward until you confirm the start.`,
      buttons: [
        { id: "CONFIRM_START_JOB", title: "Confirm job started" },
        { id: "START_NOT_YET", title: "Not started yet" },
      ],
    });
  }

  if (result.needsDelayReason) {
    const dl = result.needsDelayReason;
    await setPendingAction(ctx.conversationId, {
      type: "AWAITING_DELAY_REASON",
      stage: dl.stage,
    });
    return await reply({
      ...ctx,
      body: `The ${dl.stage.toLowerCase()} code is verified. This ${dl.stage.toLowerCase()} was about ${dl.minutesLate} min later than scheduled (${workflow.fmtWhen(dl.scheduledAt)}), so I need the reason before I can finish marking it. What caused the delay?`,
    });
  }

  return await reply({ ...ctx, body: verifiedDocumentReply(stage, result) });
}

function resolveDocumentStage(job, hintedStage, extraction = null) {
  const codes = (extraction?.codes ?? []).map(documentCode.normalizeCode);
  const pickupMatched = codes.includes(
    documentCode.normalizeCode(job.pickup_code),
  );
  const deliveryMatched = codes.includes(
    documentCode.normalizeCode(job.delivery_code),
  );

  if (pickupMatched && !deliveryMatched) return "PICKUP";
  if (deliveryMatched && !pickupMatched) return "DELIVERY";
  if (!job.pickup_verified_at) return "PICKUP";
  if (!job.delivery_verified_at) return "DELIVERY";
  return hintedStage ?? "DELIVERY";
}

async function findOpenSafetyIncident(driverId) {
  const assignment = await workflow.getDriverAssignment(pool, driverId);
  if (!assignment) return null;

  const result = await pool.query(
    `SELECT id, incident_type
       FROM incidents
      WHERE job_id = $1
        AND status IN ('OPEN', 'UNDER_REVIEW')
        AND (incident_type = 'ACCIDENT' OR severity = 'CRITICAL')
      ORDER BY created_at DESC
      LIMIT 1`,
    [assignment.job_id],
  );
  return result.rows[0] ?? null;
}

const BACKUP_BUTTONS = [
  { id: "BACKUP_NEEDED", title: "Need backup vehicle" },
  { id: "BACKUP_NOT_NEEDED", title: "No backup needed" },
];

async function beginSafetyFlow(ctx, incident, cancelReason) {
  await setPendingAction(ctx.conversationId, {
    type: "AWAITING_LOCATION",
    incidentId: incident.id,
    cancelReason: cancelReason ?? null,
  });
  return await reply({
    ...ctx,
    body: `Before we close this out, there's still an open ${incident.incident_type.toLowerCase()} report on your trip. Please share your current location using the attachment menu in WhatsApp, and let me know about a backup vehicle:`,
    buttons: BACKUP_BUTTONS,
  });
}

async function beginCancellation(ctx, reason) {
  const incident = await findOpenSafetyIncident(ctx.d.id);
  if (incident) return beginSafetyFlow(ctx, incident, reason);

  const { job } = await workflow.requestCancellation(
    ctx.d,
    reason,
    ctx.messageId,
    1,
  );
  await clearPendingAction(ctx.conversationId);
  return reply({
    ...ctx,
    body: `Done, your cancellation request for *${job.job_number}*${reason ? ` (reason: ${reason})` : ""} is with the manager now. The job stays with you until they decide.`,
  });
}

async function applySafetyCheck(
  ctx,
  pending,
  { lat = null, lng = null, backup = null },
) {
  if (lat != null && lng != null) {
    await pool.query(
      `UPDATE incidents
          SET location_lat = $2, location_lng = $3, location_received_at = now()
        WHERE id = $1`,
      [pending.incidentId, lat, lng],
    );
  }
  if (backup) {
    await pool.query(`UPDATE incidents SET backup_vehicle = $2 WHERE id = $1`, [
      pending.incidentId,
      backup,
    ]);
  }

  const incident = (
    await pool.query(
      `SELECT location_lat, location_lng, backup_vehicle
       FROM incidents
      WHERE id = $1 AND status IN ('OPEN', 'UNDER_REVIEW')`,
      [pending.incidentId],
    )
  ).rows[0];

  if (!incident) {
    await clearPendingAction(ctx.conversationId);
    return reply({
      ...ctx,
      body: "That incident is already closed, so no further safety details are needed.",
    });
  }
  if (incident.location_lat == null) {
    await setPendingAction(ctx.conversationId, {
      ...pending,
      type: "AWAITING_LOCATION",
    });
    return reply({
      ...ctx,
      body: "Noted. Now share your current location using the attachment menu in WhatsApp so the manager knows where you are.",
    });
  }
  if (!incident.backup_vehicle) {
    await setPendingAction(ctx.conversationId, {
      ...pending,
      type: "AWAITING_BACKUP",
    });
    return reply({
      ...ctx,
      body: "Location received. Do you need a backup vehicle?",
      buttons: BACKUP_BUTTONS,
    });
  }

  const { job } = await workflow.requestCancellation(
    ctx.d,
    pending.cancelReason ?? "Incident follow-up",
    ctx.messageId,
    1,
  );
  await clearPendingAction(ctx.conversationId);
  await workflow.notifyManagers(pool, {
    organizationId: ctx.d.organization_id,
    jobId: job.id,
    type: "SAFETY_CHECK_COMPLETE",
    title: `Safety check complete for ${job.job_number}`,
    body: `Driver location: https://www.google.com/maps?q=${incident.location_lat},${incident.location_lng}. Backup vehicle: ${incident.backup_vehicle === "REQUESTED" ? "requested" : "not needed"}. Cancellation request is waiting for review.`,
    severity: "HIGH",
  });
  return reply({
    ...ctx,
    body: `Thanks, your location and backup details are recorded. Your cancellation request for *${job.job_number}* is with the manager now.`,
  });
}

async function describeBlocker(driver) {
  try {
    const progress = await workflow.describeProgress(driver);
    if (!progress || !progress.live) return null;

    const rank = workflow.stateMachine.rankOf(progress.stage) ?? 0;
    const R = workflow.stateMachine.STAGE_RANK;

    if (rank < R.LOADED && !progress.verifiedPickup) {
      return "the signed pickup document. The job cannot be marked loaded until the driver sends a photo of it and the pickup code is verified. If the depot or site staff are holding the paperwork, the driver should collect it from them and send the photo here.";
    }
    if (rank < R.DELIVERED && !progress.verifiedDelivery) {
      return "the signed delivery document. The job cannot be marked delivered until the driver sends a photo of it and the delivery code is verified. If the receiver is holding the paperwork, the driver should collect it from them and send the photo here.";
    }
    if (rank >= R.DELIVERED && rank < R.DRIVER_SUBMITTED_COMPLETION) {
      return "the driver sending the job for closure, which the manager then approves.";
    }
    if (
      progress.stage === "DRIVER_SUBMITTED_COMPLETION" ||
      progress.stage === "MANAGER_REVIEW"
    ) {
      return "the manager approving the closure. Nothing is needed from the driver.";
    }
    return null;
  } catch (err) {
    console.error("Could not describe the current blocker:", err.message);
    return null;
  }
}

async function voiceOf(ctx, situation) {
  return friendlyReply({
    situation,
    driverName: ctx.d.name,
    activeJob: ctx.interp?.activeJob ?? null,
    activeJobSummary: ctx.interp?.activeJobSummary ?? null,
    availableJobs: ctx.interp?.availableJobs ?? [],
    driverMessage: ctx.driverText ?? null,
    recentMessages: ctx.interp?.recentMessages ?? [],
  });
}

async function processInboundCore({
  driver,
  conversationId,
  messageId,
  messageType,
  bodyText,
  buttonId,
  replyToMessageId,
}) {
  const d = {
    id: driver.driver_id ?? driver.id,
    name: driver.name,
    organization_id: driver.organization_id,
    vehicle_type: driver.vehicle_type ?? null,
  };
  const phone = (driver.phone_e164 ?? "").replace(/\D/g, "") || driver.waId;
  const ctx = { d, phone, conversationId, messageId, replyToMessageId };

  try {
    if (buttonId) {
      return await handleButton(buttonId, ctx);
    }

    let text = (bodyText ?? "").trim();

    if (messageType === "LOCATION") {
      const pendingLoc = await getPendingAction(conversationId);
      if (["AWAITING_LOCATION", "AWAITING_BACKUP"].includes(pendingLoc?.type)) {
        const m = text.match(/-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?/);
        if (!m) {
          return await reply({
            ...ctx,
            body: "Hmm, I couldn't read that location, use the attachment menu in WhatsApp and choose Location to share your position.",
          });
        }
        const [lat, lng] = m[0].split(",").map((s) => s.trim());
        return await applySafetyCheck(ctx, pendingLoc, { lat, lng });
      }
      const incident = await findOpenSafetyIncident(d.id);
      if (incident) {
        const m = text.match(/-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?/);
        if (m) {
          const [lat, lng] = m[0].split(",").map((s) => s.trim());
          await pool.query(
            `UPDATE incidents SET location_lat = $2, location_lng = $3, location_received_at = now() WHERE id = $1`,
            [incident.id, lat, lng],
          );
        }
        return await reply({
          ...ctx,
          body: "Got it, the manager can see where you are now.",
        });
      }
      return await reply({ ...ctx, body: "Location noted, thanks!" });
    }

    if (messageType === "AUDIO") {
      const transcript = await transcribeVoiceMessage(messageId);
      if (!transcript) {
        return await reply({
          ...ctx,
          body: `I got your voice note but couldn't make it out, mind typing it, or sending a clearer recording?`,
        });
      }
      await reply({ ...ctx, body: `I heard: "${transcript}"` });
      text = transcript;
    }

    if (messageType === "IMAGE" || messageType === "DOCUMENT") {
      if (/^\[(image|document)\]$/i.test(text)) text = "";
      const handled = await handleInboundImage(ctx, text || null);
      if (handled) return handled;
      const doc = await prepareDocumentContext(ctx, text || null);
      if (doc?.needsJobChoice) {
        return await reply({
          ...ctx,
          body: "Which job is this for? Tap below",
          listRows: doc.jobRows,
        });
      }
      if (doc) {
        ctx.document = doc;
        if (!text) return await reply({ ...ctx, body: doc.confirmation });
      }
    }

    if (!text) {
      return await reply({
        ...ctx,
        body: 'Hmm, that came through empty on my side, can you type it out? (e.g. "loaded 18 pallets")',
      });
    }

    const pending = await getPendingAction(conversationId);
    if (["AWAITING_LOCATION", "AWAITING_BACKUP"].includes(pending?.type)) {
      return await reply({
        ...ctx,
        body: "Almost done, share your current location using the attachment menu in WhatsApp, or tap one of the backup options above. ",
      });
    }
    if (pending?.type === "AWAITING_CANCEL_REASON") {
      if (/never mind|forget it|ignore|sorry|keep (the )?job/i.test(text)) {
        await clearPendingAction(conversationId);
        return await reply({
          ...ctx,
          body: "No worries, your job stays as it is. ",
        });
      }
      return await beginCancellation(ctx, text);
    }

    if (pending?.type === "AWAITING_CANCEL_DETAILS") {
      if (/never mind|forget it|ignore|sorry|keep (the )?job/i.test(text)) {
        await clearPendingAction(conversationId);
        return await reply({
          ...ctx,
          body: "No worries, your job stays as it is.",
        });
      }
      const details = text.slice(0, 500);
      return await beginCancellation(ctx, `${pending.reason}: ${details}`);
    }

    if (pending?.type === "AWAITING_DELAY_REASON") {
      const stage = pending.stage === "DELIVERY" ? "DELIVERY" : "PICKUP";
      await clearPendingAction(conversationId);
      const rec = await workflow.recordStageDelay(
        d,
        stage,
        text.slice(0, 500),
        messageId,
      );
      const lines = [
        rec.alreadyRecorded
          ? `I already had the ${stage.toLowerCase()} delay reason noted, so nothing changed.`
          : `Noted, thanks. The ${stage.toLowerCase()} delay (${rec.minutesLate} min late) is recorded and the manager can see it.`,
      ];
      const cont = await workflow.applyPendingVerifications(d, messageId);
      await appendPendingContinuation(lines, ctx, cont);
      return await reply({ ...ctx, body: lines.join(" ") });
    }

    const screen = await screenMessage(text);
    if (!screen.safe) {
      await storeInterpretation(
        messageId,
        {
          intent: "BLOCKED_INJECTION",
          events: [],
          job_reference: null,
          extracted_data: { score: screen.score },
          confidence: 1,
        },
        "REQUIRES_REVIEW",
        "Prompt-injection screening blocked this message",
      );
      await workflow.notifyManagers(pool, {
        organizationId: d.organization_id,
        type: "SECURITY_ALERT",
        title: `Suspicious message from ${d.name}`,
        body: `Message blocked by prompt-injection screening (score ${screen.score}): "${text.slice(0, 200)}"`,
        severity: "WARNING",
      });
      return await reply({
        ...ctx,
        body: "Hmm, that message didn't come through right, just send it to me in your own words, like a normal job update.",
      });
    }

    const interpCtx = await loadInterpreterContext(d, conversationId);
    ctx.interp = interpCtx;
    ctx.driverText = text;
    const candidate = await interpretMessage({ text, driver: d, ...interpCtx });
    await storeInterpretation(messageId, candidate, "COMPLETED");

    const quotedJobId = await quotedApplyInviteJobId(
      conversationId,
      replyToMessageId,
    );
    const isApplyReply =
      candidate.intent === "CONFIRM_EVENT" ||
      candidate.intent === "REQUEST_JOB" ||
      /^apply(?:\s+now)?$/i.test(text);
    if (quotedJobId && isApplyReply) {
      await clearPendingAction(conversationId);
      return await submitApplyRequest(ctx, quotedJobId);
    }

    if (
      pending?.type === "AWAITING_ACCEPT_DECLINE" &&
      candidate.intent === "CONFIRM_EVENT"
    ) {
      await clearPendingAction(conversationId);
      return await applyCandidate(
        {
          intent: "ACCEPT_JOB",
          job_reference: null,
          extracted_data: {},
          confidence: 1,
          events: [],
        },
        ctx,
        { confirmed: true },
      );
    }

    if (
      pending?.type === "AWAITING_APPLY" &&
      (candidate.intent === "CONFIRM_EVENT" ||
        candidate.intent === "REQUEST_JOB")
    ) {
      const inviteJobId = pending.job_id;
      await clearPendingAction(conversationId);
      return await submitApplyRequest(ctx, inviteJobId);
    }

    if (
      pending?.type === "AWAITING_START_CONFIRM" &&
      candidate.intent === "CONFIRM_EVENT"
    ) {
      await clearPendingAction(conversationId);
      return await confirmStartAndContinue(ctx, pending.candidate ?? null);
    }

    if (pending?.type === "AWAITING_CONFIRMATION") {
      if (candidate.intent === "CONFIRM_EVENT") {
        await clearPendingAction(conversationId);
        return await applyCandidate(pending.candidate, ctx, {
          confirmed: true,
        });
      }
      if (candidate.intent === "CORRECT_EVENT") {
        const merged = {
          ...pending.candidate,
          extracted_data: {
            ...pending.candidate.extracted_data,
            ...candidate.extracted_data,
          },
        };
        await setPendingAction(conversationId, {
          type: "AWAITING_CONFIRMATION",
          candidate: merged,
        });
        return await askConfirmation(merged, ctx);
      }
      await clearPendingAction(conversationId);
    }

    if (pending?.type === "AWAITING_FREEFORM_ANSWER") {
      await clearPendingAction(conversationId);
      if (
        ["CONFIRM_EVENT", "CORRECT_EVENT", "UNKNOWN"].includes(candidate.intent)
      ) {
        const blocker = await describeBlocker(d);
        const human = await voiceOf(
          ctx,
          [
            `You asked the driver: "${pending.question}"`,
            `They replied: "${text}"`,
            "Answer their reply directly and give the one next step that follows from it.",
            blocker
              ? `What the trip is waiting on right now: ${blocker}`
              : null,
            "Never claim an action was taken or recorded. Do not use emojis or em dashes.",
          ]
            .filter(Boolean)
            .join(" "),
        );
        if (human) return await reply({ ...ctx, body: human });
      }
    }

    return await routeCandidate(candidate, ctx);
  } catch (err) {
    if (err instanceof workflow.WorkflowError) {
      const VERBATIM = [
        "PROTECTED_MILESTONE",
        "VERIFICATION_REQUIRED",
        "JOB_FROZEN",
        "NOT_DELIVERED",
        "START_TOO_EARLY",
        "START_CONFIRMATION_REQUIRED",
        "NO_DELAY",
      ];
      if (VERBATIM.includes(err.code)) {
        return await reply({ ...ctx, body: err.message });
      }
      if (err.code === "BAD_STATE") {
        const progress = await workflow.describeProgress(d).catch(() => null);
        if (progress && !progress.live) {
          return await reply({
            ...ctx,
            body: `*${progress.job.job_number}* is ${progress.label} and you're no longer assigned to it, so its status can't change. Say "jobs" when you're ready for the next one.`,
          });
        }
      }
      const human = await voiceOf(
        ctx,
        `The driver's update could not be applied. Reason: "${err.message}". Explain warmly and briefly what is missing and the one thing they can do next. Do not claim anything was recorded. Do not use emojis or em dashes.`,
      );
      return await reply({ ...ctx, body: human ?? err.message });
    }
    console.error("Bot processing failed:", err);
    return await reply({
      ...ctx,
      body: "Something went wrong on my side. Please try again in a moment.",
    }).catch(() => {});
  }
}

async function processInbound(args) {
  if (await isAiPaused(args.conversationId)) {
    return { skipped: "MANAGER_TAKEOVER" };
  }
  const result = await processInboundCore(args);
  const driverId = args.driver.driver_id ?? args.driver.id;
  summarizer
    .tickAfterMessage(driverId, args.conversationId)
    .catch((err) => console.error("Summary refresh failed:", err.message));
  return result;
}

async function submitApplyRequest(ctx, jobId) {
  const { d, messageId } = ctx;
  const job = (
    await pool.query(
      `SELECT id, organization_id, job_number, current_status, pickup_at, cargo_description
       FROM jobs
      WHERE id = $1`,
      [jobId],
    )
  ).rows[0];
  if (!job)
    return await reply({
      ...ctx,
      body: "That job is no longer open, say \"jobs\" and I'll show what's available.",
    });
  try {
    const { job: requested } = await workflow.requestJob(d, job, messageId, 1);
    return await reply({
      ...ctx,
      body: `Done, I've asked the manager about *${requested.job_number}*. I'll ping you the moment it's approved!`,
    });
  } catch (err) {
    if (err.code === "DUPLICATE_REQUEST") {
      return await reply({
        ...ctx,
        body: `You're already in the running for *${job.job_number}* — just waiting on the manager now.`,
      });
    }
    if (err.code === "DRIVER_BUSY") {
      return await reply({
        ...ctx,
        body: "You're already tied to another job — finish that one and I'll line up the next.",
      });
    }
    if (err.code === "JOB_NOT_OPEN") {
      return await reply({
        ...ctx,
        body: `*${job.job_number}* is no longer open. Say "jobs" and I'll show what's available now.`,
      });
    }
    if (err.code === "JOB_OUTSIDE_WINDOW") {
      return await reply({
        ...ctx,
        body: `*${job.job_number}* can only be requested within 24 hours of pickup. Say "jobs" for jobs you can request now.`,
      });
    }
    if (err.code === "DRIVER_RELEASED") {
      return await reply({
        ...ctx,
        body: `You were released from *${job.job_number}*, so it cannot be requested again.`,
      });
    }
    console.error(
      `Apply request for ${job.job_number} was rejected:`,
      err.code ?? err.message,
    );
    return await reply({
      ...ctx,
      body: `Couldn't put your name in for *${job.job_number}* right now, give it another go in a bit.`,
    });
  }
}

async function handleButton(buttonId, ctx) {
  const { d, conversationId, messageId } = ctx;

  if (buttonId.startsWith("APPLY_JOB:")) {
    return await submitApplyRequest(ctx, buttonId.slice("APPLY_JOB:".length));
  }

  if (buttonId === "APPLY_JOB") {
    const quotedJobId = await quotedApplyInviteJobId(
      conversationId,
      ctx.replyToMessageId,
    );
    const pending = await getPendingAction(conversationId);
    const jobId = quotedJobId ?? pending?.job_id;
    await clearPendingAction(conversationId);
    if (!jobId)
      return await reply({
        ...ctx,
        body: "That invite expired on me, say \"jobs\" and I'll show what's open.",
      });
    return await submitApplyRequest(ctx, jobId);
  }

  if (buttonId === "ACCEPT_JOB" || buttonId === "DECLINE_JOB") {
    const fn =
      buttonId === "ACCEPT_JOB" ? workflow.acceptJob : workflow.declineJob;
    const { job } = await fn(d, messageId, 1);
    await clearPendingAction(conversationId);
    if (buttonId === "ACCEPT_JOB") {
      summarizer
        .ensureSummaryRow(job.id, d.id)
        .catch((err) =>
          console.error("Summary row create failed:", err.message),
        );
    }
    return await reply({
      ...ctx,
      body:
        buttonId === "ACCEPT_JOB"
          ? `You're on *${job.job_number}*. Just say "start ${job.job_number}" when you're ready to roll.`
          : `No worries, *${job.job_number}* goes back to the pool.`,
    });
  }

  if (buttonId === "CONFIRM_YES" || buttonId === "CONFIRM_NO") {
    const pending = await getPendingAction(conversationId);
    if (pending?.type !== "AWAITING_CONFIRMATION") {
      return await reply({
        ...ctx,
        body: "That one expired on me, send the update again and I'll pick it up.",
      });
    }
    await clearPendingAction(conversationId);
    if (buttonId === "CONFIRM_NO") {
      return await reply({
        ...ctx,
        body: "No problem, scrapped it, nothing changed. ",
      });
    }
    return await applyCandidate(pending.candidate, ctx, { confirmed: true });
  }

  if (buttonId.startsWith("CANCEL_REASON:")) {
    const pending = await getPendingAction(conversationId);
    if (pending?.type !== "AWAITING_CANCEL_REASON") {
      return await reply({
        ...ctx,
        body: "There's no cancellation request open right now, all good. ",
      });
    }
    const labels = {
      VEHICLE_PROBLEM: "Vehicle problem",
      ACCIDENT: "Accident",
      CUSTOMER_ISSUE: "Customer issue",
      PERSONAL: "Personal reason",
      OTHER: "Other",
    };
    const code = buttonId.slice("CANCEL_REASON:".length);
    const reason = labels[code] ?? "Other";
    if (["CUSTOMER_ISSUE", "PERSONAL", "OTHER"].includes(code)) {
      await setPendingAction(conversationId, {
        type: "AWAITING_CANCEL_DETAILS",
        reason,
      });
      return await reply({
        ...ctx,
        body: `Please tell me a little more about the ${reason.toLowerCase()}. I will include it with the manager's cancellation review.`,
      });
    }
    return await beginCancellation(ctx, reason);
  }

  if (buttonId === "END_JOB_CONFIRM_YES" || buttonId === "END_JOB_CONFIRM_NO") {
    if (buttonId === "END_JOB_CONFIRM_NO") {
      return await reply({
        ...ctx,
        body: "Got it, trip stays open. Keep the updates coming! ",
      });
    }
    return await applyCandidate(
      {
        intent: "END_JOB",
        job_reference: null,
        extracted_data: {},
        confidence: 1,
        events: [],
      },
      ctx,
      { confirmed: true },
    );
  }

  if (buttonId === "BACKUP_NEEDED" || buttonId === "BACKUP_NOT_NEEDED") {
    const pending = await getPendingAction(conversationId);
    if (!["AWAITING_LOCATION", "AWAITING_BACKUP"].includes(pending?.type)) {
      return await reply({
        ...ctx,
        body: "There is no safety check in progress right now.",
      });
    }
    return await applySafetyCheck(ctx, pending, {
      backup: buttonId === "BACKUP_NEEDED" ? "REQUESTED" : "DECLINED",
    });
  }

  if (buttonId === "GAP_START_YES" || buttonId === "GAP_START_NO") {
    const pending = await getPendingAction(conversationId);
    if (pending?.type !== "GAP_START") {
      return await reply({
        ...ctx,
        body: "That one expired on me, send the update again and I'll pick it up.",
      });
    }
    await clearPendingAction(conversationId);
    if (buttonId === "GAP_START_NO") {
      return await reply({
        ...ctx,
        body: "No problem Nothing logged, just say the word when you want to start the trip.",
      });
    }
    return await confirmStartAndContinue(ctx, pending.candidate ?? null);
  }

  if (buttonId === "CONFIRM_START_JOB" || buttonId === "START_NOT_YET") {
    const pending = await getPendingAction(conversationId);
    if (pending?.type !== "AWAITING_START_CONFIRM") {
      return await reply({
        ...ctx,
        body: "That one expired on me, send the update again and I'll pick it up.",
      });
    }
    await clearPendingAction(conversationId);
    if (buttonId === "START_NOT_YET") {
      return await reply({
        ...ctx,
        body: 'No problem, nothing changed. Just say "start job" here when you actually roll.',
      });
    }
    return await confirmStartAndContinue(ctx, pending.candidate ?? null);
  }

  if (buttonId.startsWith("CHOOSE_JOB:")) {
    const jobId = buttonId.slice("CHOOSE_JOB:".length);
    const job = (await pool.query("SELECT * FROM jobs WHERE id = $1", [jobId]))
      .rows[0];
    if (!job)
      return await reply({
        ...ctx,
        body: "Ah, that one's gone already, say \"jobs\" and I'll show you what's open now.",
      });
    await clearPendingAction(conversationId);
    const { job: requested } = await workflow.requestJob(d, job, messageId, 1);
    return await reply({
      ...ctx,
      body: `Done, I've asked the manager about *${requested.job_number}*. I'll ping you the moment it's approved!`,
    });
  }

  if (buttonId.startsWith("DOC_JOB:")) {
    const pending = await getPendingAction(conversationId);
    const jobId = buttonId.slice("DOC_JOB:".length);
    if (pending?.type !== "AWAITING_DOC_JOB_CHOICE") {
      return await reply({
        ...ctx,
        body: "That document request expired, mind sending the photo again ? ",
      });
    }
    const { job } = await workflow.attachDocuments(d, {
      attachmentIds: pending.attachmentIds,
      documentType: pending.documentType,
      caption: pending.caption,
      jobId,
      messageId: pending.messageId,
      confidence: 1,
    });
    await clearPendingAction(conversationId);
    return await reply({
      ...ctx,
      body: `Got it, attached to *${job.job_number}*. The manager can see it now.`,
    });
  }

  return await reply({
    ...ctx,
    body: "Hmm, that button's from an old message, what's happening with the trip?",
  });
}

async function routeCandidate(candidate, ctx) {
  const { d, conversationId, messageId } = ctx;

  if (candidate.intent === "UNLOADED") {
    candidate = { ...candidate, intent: "DELIVERED" };
  }

  const rawText = ctx.driverText ?? "";
  if (
    candidate.intent === "UNKNOWN" &&
    /\b(jobs?|loads?|work)\b/i.test(rawText) &&
    !/(did|done|before|previous|prev|past|history|earlier|completed|finished)/i.test(
      rawText,
    )
  ) {
    return await applyCandidate(
      { ...candidate, intent: "SHOW_AVAILABLE_JOBS" },
      ctx,
      { confirmed: false },
    );
  }

  if (candidate.intent === "END_JOB") {
    const incident = await findOpenSafetyIncident(d.id);
    if (incident)
      return await beginSafetyFlow(
        ctx,
        incident,
        "Driver asked to end the trip after an incident",
      );

    const assignment = await workflow.getDriverAssignment(pool, d.id);
    if (assignment?.status === "ACTIVE") {
      const job = (
        await pool.query("SELECT * FROM jobs WHERE id = $1", [
          assignment.job_id,
        ])
      ).rows[0];
      if (job) {
        const rank = await workflow.currentMilestoneRank(pool, job);
        if (rank < workflow.MILESTONE_RANK.DELIVERED) {
          return await reply({
            ...ctx,
            body: `I can't send *${job.job_number}* for closure yet because the delivery isn't confirmed. Please upload the delivery document so I can verify the delivery code and mark the job as delivered.`,
          });
        }
      }
    }

    return await applyCandidate(candidate, ctx, { confirmed: true });
  }

  if (candidate.confidence < CLARIFY_MIN && candidate.intent !== "UNKNOWN") {
    await setPendingAction(conversationId, {
      type: "AWAITING_CLARIFICATION",
      candidate,
    });
    return await reply({
      ...ctx,
      body:
        candidate.clarification_question ??
        `I am not sure I understood. Did you mean *${candidate.intent.replace(/_/g, " ").toLowerCase()}*? Please rephrase or add the job number.`,
    });
  }

  if (candidate.clarification_question && candidate.intent !== "UNKNOWN") {
    await setPendingAction(conversationId, {
      type: "AWAITING_CLARIFICATION",
      candidate,
    });
    return await reply({ ...ctx, body: candidate.clarification_question });
  }

  if (
    STATE_CHANGING.has(candidate.intent) &&
    (candidate.needs_confirmation || candidate.confidence < AUTO_APPLY_MIN)
  ) {
    await setPendingAction(conversationId, {
      type: "AWAITING_CONFIRMATION",
      candidate,
    });
    return await askConfirmation(candidate, ctx);
  }

  return await applyCandidate(candidate, ctx, { confirmed: false });
}

async function askConfirmation(candidate, ctx) {
  return await reply({
    ...ctx,
    body: `Just to be sure: ${candidateSummary(candidate, candidate.job_reference)}, did I get that right?`,
    buttons: [
      { id: "CONFIRM_YES", title: "Confirm" },
      { id: "CONFIRM_NO", title: "Cancel" },
    ],
  });
}

async function applyCandidate(candidate, ctx, { confirmed }) {
  if (MILESTONE_SET.has(candidate.intent)) {
    return applyMilestoneCandidate(candidate, ctx, { confirmed });
  }

  const { d, messageId } = ctx;
  const data = candidate.extracted_data ?? {};
  const confidence = confirmed
    ? Math.max(candidate.confidence, 0.9)
    : candidate.confidence;

  switch (candidate.intent) {
    case "GREETING": {
      const assignment = await workflow.getDriverAssignment(pool, d.id);
      return await reply({
        ...ctx,
        body: assignment
          ? `Hey ${firstName(d.name)}, you're on *${assignment.job_number}*. Keep me posted as you go.`
          : `Hey ${firstName(d.name)}, looking for work? Just say "jobs" and I'll show you what's open.`,
      });
    }

    case "SHOW_AVAILABLE_JOBS": {
      const assignment = await workflow.getDriverAssignment(pool, d.id);
      if (assignment) {
        return await reply({
          ...ctx,
          body: `You're already on *${assignment.job_number}* right now, let's finish that one first, then we'll find you the next load.`,
        });
      }
      const jobs = await vehicleMatch.filterJobsForDriver(
        d,
        await workflow.listAvailableJobs(d),
      );
      if (jobs.length === 0) {
        const fit = d.vehicle_type ? ` that suits your ${d.vehicle_type}` : "";
        return await reply({
          ...ctx,
          body: `Nothing open${fit} right now, I'll message you the second a suitable job drops.`,
        });
      }
      await setPendingAction(ctx.conversationId, {
        type: "AWAITING_JOB_CHOICE",
        jobIds: jobs.map((j) => j.id),
      });
      return await reply({
        ...ctx,
        body: `Here's what's open right now:\n${jobs.map((j) => `• ${fmtJobLine(j)}`).join("\n")}\n\nTap one below and I'll put your name in.`,
        listRows: jobChoiceRows(jobs),
      });
    }

    case "REQUEST_JOB": {
      if (!candidate.job_reference) {
        const jobs = await vehicleMatch.filterJobsForDriver(
          d,
          await workflow.listAvailableJobs(d),
        );
        if (jobs.length === 0) {
          const fit = d.vehicle_type
            ? ` that suits your ${d.vehicle_type}`
            : "";
          return await reply({
            ...ctx,
            body: `Nothing open${fit} to request right now, I'll ping you as soon as a suitable job drops.`,
          });
        }
        await setPendingAction(ctx.conversationId, {
          type: "AWAITING_JOB_CHOICE",
          jobIds: jobs.map((j) => j.id),
        });
        return await reply({
          ...ctx,
          body: "Which one do you want? Tap below",
          listRows: jobChoiceRows(jobs),
        });
      }
      const job = await workflow.getJobByNumber(
        pool,
        d.organization_id,
        candidate.job_reference,
      );
      if (!job)
        return await reply({
          ...ctx,
          body: `Hmm, I can't find a job matching "${candidate.job_reference}", say "jobs" and I'll list what's open.`,
        });
      const { job: requested } = await workflow.requestJob(
        d,
        job,
        messageId,
        confidence,
      );
      return await reply({
        ...ctx,
        body: `Done, I've asked the manager about *${requested.job_number}*. I'll ping you the moment it's approved!`,
      });
    }

    case "CANCEL_JOB_REQUEST": {
      const { job } = await workflow.cancelJobRequest(d, messageId, confidence);
      return await reply({
        ...ctx,
        body: `Done, request for *${job.job_number}* withdrawn. `,
      });
    }

    case "ACCEPT_JOB": {
      const { job } = await workflow.acceptJob(d, messageId, confidence);
      summarizer
        .ensureSummaryRow(job.id, d.id)
        .catch((err) =>
          console.error("Summary row create failed:", err.message),
        );
      return await reply({
        ...ctx,
        body: `You're on *${job.job_number}*! Say "start ${job.job_number}" when you're ready to roll. `,
      });
    }

    case "DECLINE_JOB": {
      const { job } = await workflow.declineJob(d, messageId, confidence);
      return await reply({
        ...ctx,
        body: `No worries, *${job.job_number}* goes back to the pool. `,
      });
    }

    case "START_JOB": {
      const { job, alreadyStarted } = await workflow.startJob(
        d,
        messageId,
        confidence,
      );
      if (alreadyStarted) {
        if (data.correction) {
          return await reply({
            ...ctx,
            body: `You've already confirmed the start of *${job.job_number}*, so I can't take it back to not started from my side. If something went wrong, tell me what happened and I'll flag it to the manager.`,
          });
        }
        return await reply({
          ...ctx,
          body: `*${job.job_number}* is already started, so nothing changed. Keep me posted as you go.`,
        });
      }
      const lines = [
        `*${job.job_number}* is rolling. Keep me posted as you go: "reached pickup", "on my way", "at delivery". Drive safe.`,
      ];
      const cont = await workflow.applyPendingVerifications(d, messageId);
      await appendPendingContinuation(lines, ctx, cont);
      return await reply({ ...ctx, body: lines.join(" ") });
    }

    case "ASK_PROGRESS": {
      const progress = await workflow.describeProgress(d);
      if (!progress) {
        return await reply({
          ...ctx,
          body: 'You are not on a job right now. Say "jobs" and I will show you what is open.',
        });
      }
      const next = progress.nextStep ? ` ${progress.nextStep}` : "";
      const pendingBits = (progress.pending ?? []).map((p) => p.message);
      const pendingText =
        pendingBits.length > 0
          ? ` Still needed from you: ${joinList(pendingBits)}.`
          : "";
      return await reply({
        ...ctx,
        body: `You're currently marked as ${progress.label} on *${progress.job.job_number}*.${next}${pendingText}`,
      });
    }

    case "DELAY_REPORTED": {
      const delayText = `${ctx.driverText ?? ""} ${data.reason ?? ""}`;
      const stage =
        /\b(delivery|deliver|drop[ -]?off|receiver|customer)\b/i.test(delayText)
          ? "DELIVERY"
          : /\b(pick[ -]?up|collection|collect|loader|warehouse)\b/i.test(
                delayText,
              )
            ? "PICKUP"
            : null;
      const { job } = await workflow.reportDelay(
        d,
        stage ? { ...data, stage } : data,
        messageId,
        confidence,
      );
      const minutes = Number(data.delay_minutes) || 0;
      return await reply({
        ...ctx,
        body: `Noted *${job.job_number}*, ${data.reason ?? "delayed"}${minutes ? ` (~${minutes} min)` : ""}. The manager knows; just ping me when you're moving again.`,
      });
    }

    case "DAMAGE_REPORTED":
    case "SHORTAGE_REPORTED":
    case "FAILED_DELIVERY":
    case "INCIDENT_REPORTED": {
      const map = {
        DAMAGE_REPORTED: { type: "DAMAGE", eventType: "DAMAGE_REPORTED" },
        SHORTAGE_REPORTED: { type: "SHORTAGE", eventType: "SHORTAGE_REPORTED" },
        FAILED_DELIVERY: { type: "REFUSAL", eventType: "FAILED_DELIVERY" },
        INCIDENT_REPORTED: {
          type: data.incident_type,
          eventType: "INCIDENT_REPORTED",
        },
      }[candidate.intent];
      const description =
        data.description ??
        data.reason ??
        `${candidate.intent.replace(/_/g, " ").toLowerCase()} reported by driver`;
      const { job, incidentType, severity, alreadyReported } =
        await workflow.reportIncident(d, {
          incidentType: map.type,
          severity: data.severity,
          description,
          data,
          messageId,
          confidence,
          eventType: map.eventType,
        });
      const emergencyLine =
        severity === "CRITICAL"
          ? " If anyone is hurt or in danger, call emergency services first, then update me."
          : "";
      return await reply({
        ...ctx,
        body: alreadyReported
          ? `An open ${incidentType.toLowerCase()} report already exists for *${job.job_number}*, so I have not created another one.${emergencyLine} If anything changed, send me the details or a photo and I will add it to the existing report.`
          : `I've logged the ${incidentType.toLowerCase()} on *${job.job_number}* and alerted the manager (severity ${severity}).${emergencyLine} If it's safe, send me a photo of the situation. Stay safe, I'm right here if anything changes.`,
      });
    }

    case "CANCELLATION_REQUESTED": {
      if (!data.reason) {
        await setPendingAction(ctx.conversationId, {
          type: "AWAITING_CANCEL_REASON",
        });
        return await reply({
          ...ctx,
          body: "Of course, I can ask the manager to cancel this trip. What happened? (They review every request.)",
          listRows: [
            { id: "CANCEL_REASON:VEHICLE_PROBLEM", title: "Vehicle problem" },
            { id: "CANCEL_REASON:ACCIDENT", title: "Accident" },
            { id: "CANCEL_REASON:CUSTOMER_ISSUE", title: "Customer issue" },
            { id: "CANCEL_REASON:PERSONAL", title: "Personal reason" },
            { id: "CANCEL_REASON:OTHER", title: "Other" },
          ],
        });
      }
      return await beginCancellation(ctx, data.reason);
    }

    case "END_JOB": {
      const { job, alreadyRequested } = await workflow.endJob(
        d,
        messageId,
        confidence,
      );
      if (alreadyRequested) {
        return await reply({
          ...ctx,
          body: `*${job.job_number}* is already with the manager for closure, so I haven't sent it again. I'll let you know as soon as it's approved.`,
        });
      }
      const needsPod =
        /pod/i.test(job.special_instructions ?? "") &&
        !(await workflow.hasPodDocument(job.id));
      const podWarning = needsPod
        ? " One last thing, this job needs a signed POD, so send a photo of it here when you can."
        : "";
      return await reply({
        ...ctx,
        body: `Done. *${job.job_number}* has been sent to the manager for closure.${podWarning} I'll let you know once it's approved.`,
      });
    }

    case "DOCUMENT_RECEIVED": {
      if (ctx.document?.linked || ctx.document?.confirmation) {
        return await reply({ ...ctx, body: ctx.document.confirmation });
      }
      return await reply({
        ...ctx,
        body: "Send the photo or document right here and I'll attach it to your job. ",
      });
    }

    case "CONFIRM_EVENT":
    case "CORRECT_EVENT":

    case "ASK_IDENTITY": {
      return await reply({
        ...ctx,
        body: "I'm the SwiftMove Logistics internal AI agent. I work with the dispatch team to track trips, send me progress updates, photos, voice notes or questions and I'll keep the manager informed.",
      });
    }

    case "ASK_HISTORY": {
      const history = await pool.query(
        `SELECT j.job_number, j.cargo_description, j.completed_at,
                pl.name AS pickup, dl.name AS delivery
           FROM job_assignments ja
           JOIN jobs j ON j.id = ja.job_id
           LEFT JOIN job_stops ps ON ps.job_id = j.id AND ps.stop_type = 'PICKUP'
           LEFT JOIN locations pl ON pl.id = ps.location_id
           LEFT JOIN job_stops ds ON ds.job_id = j.id AND ds.stop_type = 'DELIVERY'
           LEFT JOIN locations dl ON dl.id = ds.location_id
          WHERE ja.driver_id = $1 AND ja.status = 'COMPLETED'
          ORDER BY COALESCE(ja.completed_at, j.completed_at) DESC NULLS LAST
          LIMIT 10`,
        [d.id],
      );
      if (history.rows.length === 0) {
        return await reply({
          ...ctx,
          body: 'No completed trips on record yet, your first one is still ahead of you! Say "jobs" when you\'re ready. ',
        });
      }
      const lines = history.rows.map((r) => {
        const finished = formatWhen(r.completed_at, { day: "2-digit", month: "short" });
        const when = finished ? ` (finished ${finished})` : "";
        return `• *${r.job_number}*: ${r.pickup ?? "?"} → ${r.delivery ?? "?"}, ${r.cargo_description}${when}`;
      });
      return await reply({
        ...ctx,
        body: `Here are your recent trips:\n${lines.join("\n")}`,
      });
    }

    case "HELP": {
      return await reply({
        ...ctx,
        body: [
          `Here's what you can just tell me, anytime:`,
          '• "jobs", see open jobs and grab one',
          '• "cancel my request", withdraw a pending request',
          '• "start JOB-1042", kick off your trip',
          '• Progress: "reached pickup", "on my way", "at delivery"',
          "• \"what's my status\", I'll tell you where the job stands",
          "• Loaded and Delivered are set from your paperwork: send a photo of the pickup document, then the delivery document, and I verify the code and update the job",
          '• Trouble: "delayed 45 min traffic", "2 boxes damaged", "breakdown", "accident"',
          '• "cancel this job", ask the manager to cancel',
          '• "close the job", send it to the manager for closure once delivery is verified',
          "• Voice notes work too",
        ].join("\n"),
      });
    }

    case "UNKNOWN":
    default: {
      const blocker = await describeBlocker(d);
      const situation = [
        "The driver's message could not be matched to any job action. Most likely it is unclear, gibberish, in a mix of languages, or off-topic.",
        "If it clearly answers a question the bot asked earlier in the recent chat, treat it as that answer and reply with the sensible acknowledgement.",
        "If it is a clear question, answer it briefly from the context. If it is clear small talk, respond warmly and briefly.",
        'In every other case, ask the driver to say it again in different words, or to tell you what they need (for example "jobs", "start", a progress update, or a problem report). One short friendly question.',
        "NEVER pretend you understood an unclear message. NEVER tell the driver to upload documents, start a trip, or go anywhere unless they clearly asked what to do next.",
        blocker
          ? `Only mention this if the driver clearly asked what to do next: ${blocker}`
          : null,
        "Never claim an action was taken or recorded. Do not use emojis or em dashes.",
      ]
        .filter(Boolean)
        .join(" ");
      const human = await voiceOf(ctx, situation);
      const body =
        human ??
        candidate.clarification_question ??
        "Hmm, I didn't quite catch that, can you say it again in different words?";

      if (/\?\s*$/.test(body.trim())) {
        await setPendingAction(ctx.conversationId, {
          type: "AWAITING_FREEFORM_ANSWER",
          question: body.slice(0, 300),
        });
      }
      return await reply({ ...ctx, body });
    }
  }
}

async function applyMilestoneCandidate(candidate, ctx, { confirmed }) {
  const { d, messageId } = ctx;
  const data = { ...(candidate.extracted_data ?? {}) };
  const confidence = confirmed
    ? Math.max(candidate.confidence, 0.9)
    : candidate.confidence;

  const target = candidate.intent;

  if (workflow.stateMachine.requiresDocumentVerification(target)) {
    const stage = workflow.stateMachine.verificationStageFor(target);
    return await reply({
      ...ctx,
      body:
        stage === "PICKUP"
          ? "Thanks for the update. Please upload the pickup document so I can verify the pickup code and mark the job as loaded."
          : "Thanks for the update. Please upload the delivery document so I can verify the delivery code and mark the job as delivered.",
    });
  }

  let result;
  try {
    result = await workflow.applyMilestone(
      d,
      target,
      data,
      messageId,
      confidence,
    );
  } catch (err) {
    if (
      err instanceof workflow.WorkflowError &&
      err.code === "START_CONFIRMATION_REQUIRED"
    ) {
      await setPendingAction(ctx.conversationId, {
        type: "AWAITING_START_CONFIRM",
        candidate,
      });
      const assignment = await workflow.getDriverAssignment(pool, d.id);
      const jobRef =
        assignment?.job_number ?? candidate.job_reference ?? "your job";
      return await reply({
        ...ctx,
        body: `Got it. Before I log that, *${jobRef}* is not marked as started yet, and only you can confirm that. Once you do, I will record this update too.`,
        buttons: [
          { id: "CONFIRM_START_JOB", title: "Confirm job started" },
          { id: "START_NOT_YET", title: "Not started yet" },
        ],
      });
    }
    throw err;
  }

  const { job, inferred, newStatus, kind, noop } = result;

  if (noop) {
    return await reply({
      ...ctx,
      body: `You are already marked as ${workflow.stateMachine.label(job.current_status)} on this job, so nothing changed.`,
    });
  }

  if (kind === "BACKWARD") {
    return await reply({
      ...ctx,
      body: `Okay, I've updated the job to show that you're still ${workflow.stateMachine.label(newStatus)}.`,
    });
  }

  if (inferred.length > 0) {
    const filled = inferred.map((s) => workflow.stateMachine.label(s));
    const now = workflow.stateMachine.label(newStatus);
    return await reply({
      ...ctx,
      body: `You hadn't marked the job as ${joinList(filled)} yet, so I've updated it and you're now ${now}.`,
    });
  }

  const extra =
    newStatus === "DELIVERED_WITH_EXCEPTION"
      ? " Some items were refused, damaged or short, so the manager has been told."
      : "";
  return await reply({
    ...ctx,
    body: `Updated. The job is now marked as ${workflow.stateMachine.label(newStatus)}.${extra}`,
  });
}

async function appendPendingContinuation(lines, ctx, cont) {
  const applied = [
    ...new Set((cont?.advances ?? []).flatMap((a) => a.applied ?? [])),
  ];
  if (applied.length > 0) {
    lines.push(
      `Your verified paperwork is applied now: the job is marked as ${joinList(applied.map((s) => workflow.stateMachine.label(s)))}.`,
    );
  }
  if (cont?.needsDelayReason) {
    const dl = cont.needsDelayReason;
    await setPendingAction(ctx.conversationId, {
      type: "AWAITING_DELAY_REASON",
      stage: dl.stage,
    });
    lines.push(
      `The ${dl.stage.toLowerCase()} was about ${dl.minutesLate} min late (scheduled ${workflow.fmtWhen(dl.scheduledAt)}). What caused the delay?`,
    );
  }
}

async function confirmStartAndContinue(ctx, candidate = null) {
  const { d, messageId } = ctx;
  const { job, alreadyStarted } = await workflow.startJob(d, messageId, 1);
  const lines = [
    alreadyStarted
      ? `*${job.job_number}* was already started.`
      : `Start confirmed. *${job.job_number}* is now marked as started.`,
  ];

  const cont = await workflow.applyPendingVerifications(d, messageId);
  await appendPendingContinuation(lines, ctx, cont);

  if (candidate && MILESTONE_SET.has(candidate.intent)) {
    const targetRank = workflow.MILESTONE_RANK[candidate.intent];
    const freshJob = (
      await pool.query("SELECT * FROM jobs WHERE id = $1", [job.id])
    ).rows[0];
    const nowRank = await workflow.currentMilestoneRank(pool, freshJob);
    if (targetRank > nowRank) {
      if (
        workflow.stateMachine.requiresDocumentVerification(candidate.intent)
      ) {
        lines.push(
          workflow.stateMachine.verificationStageFor(candidate.intent) ===
            "PICKUP"
            ? "To mark it as loaded, send a photo of the pickup document."
            : "To mark it as delivered, send a photo of the delivery document.",
        );
      } else {
        const r = await workflow.applyMilestone(
          d,
          candidate.intent,
          candidate.extracted_data ?? {},
          messageId,
          1,
        );
        if (!r.noop) {
          lines.push(
            `Also logged: the job is now marked as ${workflow.stateMachine.label(r.newStatus)}.`,
          );
        }
      }
    }
  }

  return await reply({ ...ctx, body: lines.join(" ") });
}

async function findOpenConversation(driverId) {
  const result = await pool.query(
    `SELECT id FROM conversations
      WHERE driver_id = $1 AND status = 'OPEN'
      ORDER BY created_at
      LIMIT 1`,
    [driverId],
  );
  return result.rows[0]?.id ?? null;
}

async function deliverOffer({
  job,
  driver,
  body,
  buttons,
  pendingType = "AWAITING_ACCEPT_DECLINE",
}) {
  const phone = (driver.phone_e164 ?? "").replace(/\D/g, "");
  let conversationId = await findOpenConversation(driver.id);
  if (!conversationId) {
    const created = await pool.query(
      `INSERT INTO conversations (organization_id, driver_id, job_id)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [job.organization_id, driver.id, job.id],
    );
    conversationId = created.rows[0].id;
  }
  const messageId = await reply({ conversationId, phone, body, buttons });
  await setPendingAction(conversationId, { type: pendingType, job_id: job.id });
  return { conversationId, messageId };
}

async function sendJobOffer({ job, driver }) {
  return deliverOffer({
    job,
    driver,
    body: `Good news, *${job.job_number}* is yours if you want it: ${job.cargo_description}. Shall I lock it in for you?`,
    buttons: [
      { id: "ACCEPT_JOB", title: "Accept" },
      { id: "DECLINE_JOB", title: "Decline" },
    ],
  });
}

async function sendJobApplyInvite({ job, driver }) {
  const when = formatWhen(job.pickup_at, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const route = [job.pickup, job.delivery].filter(Boolean).join(" to ");
  const quantity =
    job.quantity != null ? `, ${job.quantity} ${job.unit ?? ""}`.trimEnd() : "";
  const vehicle = driver.vehicle_type
    ? ` that suits your ${driver.vehicle_type}`
    : "";
  return await deliverOffer({
    job,
    driver,
    body: `New job just posted${vehicle}: *${job.job_number}*, ${job.cargo_description}${quantity}${route ? `, ${route}` : ""}.${when ? ` Pickup ${when}.` : ""} Tap Apply now and I'll put your name in for manager approval.`,
    buttons: [{ id: `APPLY_JOB:${job.id}`, title: "Apply now" }],
    pendingType: "AWAITING_APPLY",
  });
}

/** Notify a driver about a request rejection. */
async function sendRequestRejected({ job, driver }) {
  return await notifyDriver({
    job,
    driver,
    body: `Ah, *${job.job_number}* went another way this time Say "jobs" and I'll show you what else is open.`,
  });
}

/** Generic manager-initiated WhatsApp notice to the driver of a job. */
async function notifyDriver({ job, driver, body }) {
  if (!driver) return null;
  const phone = (driver.phone_e164 ?? "").replace(/\D/g, "");
  let conversationId = await findOpenConversation(driver.id);
  if (!conversationId) {
    const created = await pool.query(
      `INSERT INTO conversations (organization_id, driver_id, job_id) VALUES ($1, $2, $3) RETURNING id`,
      [job.organization_id, driver.id, job.id],
    );
    conversationId = created.rows[0].id;
  }
  return await reply({ conversationId, phone, body });
}

/** Manager cancelled the job -> tell the driver they are free again. */
async function sendJobCancelled({ job, driver }) {
  return await notifyDriver({
    job,
    driver,
    body: `Heads up, *${job.job_number}* was cancelled by the manager. You're free for other jobs now; just say "jobs" anytime.`,
  });
}

/** Manager asks for a correction during completion review. */
async function sendCorrectionRequest({ job, driver, note }) {
  return await notifyDriver({
    job,
    driver,
    body: `The manager reviewed *${job.job_number}* and needs a small fix${note ? `: ${note}` : ""}. Send the corrected update or document here and I'll sort it.`,
  });
}

/** Manager submitted a delivered trip for closure review. */
async function sendCompletionSubmitted({ job, driver }) {
  return await notifyDriver({
    job,
    driver,
    body: `*${job.job_number}* is in final review now If any paperwork (like the signed POD) is still pending, send it here.`,
  });
}

async function sendManagerVerification({ job, driver, stage }) {
  const progress = stage === 'PICKUP' ? 'loaded' : 'delivered';
  return await notifyDriver({
    job,
    driver,
    body: `The manager verified the ${stage.toLowerCase()} code for *${job.job_number}*. Your job is now marked as ${progress}.`,
  });
}

/** Completion review outcome: job marked done, driver available again. */
async function sendJobCompleted({ job, driver }) {
  return await notifyDriver({
    job,
    driver,
    body: `*${job.job_number}* is officially complete, great work! Ready for the next one? Say "jobs" anytime.`,
  });
}

/** Manager decision on a driver's cancellation request. */
async function sendCancellationDecision({ job, driver, action }) {
  const body =
    {
      release: `Good news, your cancellation request for *${job.job_number}* was approved. You're released and free for other jobs.`,
      cancel: `Your cancellation request for *${job.job_number}* was approved and the job has been cancelled.`,
      reject: `The manager reviewed your cancellation request for *${job.job_number}* and kept the job with you. Message me if anything changed.`,
    }[action] ??
    `Update on your cancellation request for *${job.job_number}*: ${action}.`;
  return await notifyDriver({ job, driver, body });
}

module.exports = {
  processInbound,
  sendJobOffer,
  sendJobApplyInvite,
  sendRequestRejected,
  sendJobCancelled,
  sendCorrectionRequest,
  sendCompletionSubmitted,
  sendManagerVerification,
  sendJobCompleted,
  sendCancellationDecision,
  notifyDriver,
  reply,
  findOpenConversation,
  setPendingAction,
  clearPendingAction,
};
