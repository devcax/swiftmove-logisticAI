const GRAPH_API_VERSION = process.env.GRAPH_API_VERSION || 'v21.0';

function apiUrl(path) {
  return `https://graph.facebook.com/${GRAPH_API_VERSION}/${path}`;
}

async function sendTextMessage(toDigits, body) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) {
    throw new Error('WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN are not configured');
  }
  return sendPayload(toDigits, { type: 'text', text: { preview_url: false, body } });
}

async function sendInteractiveButtons(toDigits, body, buttons) {
  return sendPayload(toDigits, {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      action: {
        buttons: buttons.slice(0, 3).map((b) => ({
          type: 'reply',
          reply: { id: String(b.id).slice(0, 256), title: String(b.title).slice(0, 20) },
        })),
      },
    },
  });
}

async function sendInteractiveList(toDigits, body, buttonLabel, rows) {
  return sendPayload(toDigits, {
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: body },
      action: {
        button: String(buttonLabel || 'Choose').slice(0, 20),
        sections: [
          {
            title: 'Options',
            rows: rows.slice(0, 10).map((r) => ({
              id: String(r.id).slice(0, 256),
              title: String(r.title).slice(0, 24),
              ...(r.description ? { description: String(r.description).slice(0, 72) } : {}),
            })),
          },
        ],
      },
    },
  });
}

async function sendPayload(toDigits, payload) {
  if (process.env.WHATSAPP_DRY_RUN === 'true') {
    console.log(`[dry-run] -> ${toDigits}: ${payload.type === 'text' ? payload.text.body : JSON.stringify(payload.interactive?.body?.text)}`);
    return `dryrun-${Date.now()}`;
  }

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) {
    throw new Error('WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN are not configured');
  }

  const res = await fetch(apiUrl(`${phoneNumberId}/messages`), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toDigits.replace(/\D/g, ''),
      ...payload,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`WhatsApp send failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return data?.messages?.[0]?.id ?? null;
}

async function downloadMedia(mediaId) {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!accessToken) throw new Error('WHATSAPP_ACCESS_TOKEN is not configured');

  const metaRes = await fetch(apiUrl(mediaId), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const meta = await metaRes.json().catch(() => ({}));
  if (!metaRes.ok || !meta.url) {
    throw new Error(`Media lookup failed (${metaRes.status}): ${JSON.stringify(meta)}`);
  }

  const fileRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!fileRes.ok) throw new Error(`Media download failed (${fileRes.status})`);
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  return { buffer, mimeType: meta.mime_type ?? 'application/octet-stream' };
}

module.exports = { sendTextMessage, sendInteractiveButtons, sendInteractiveList, downloadMedia };
