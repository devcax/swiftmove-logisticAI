export const SESSION_COOKIE = "admin_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24; // 24 hours

const encoder = new TextEncoder();

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not configured");
  return secret;
}

async function hmacSha256Hex(message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createSessionToken(nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  const payload = `v1.${nowSeconds + SESSION_TTL_SECONDS}`;
  return `${payload}.${await hmacSha256Hex(payload)}`;
}

export async function verifySessionToken(
  token: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<boolean> {
  const [version, expiresRaw, signature, extra] = token.split(".");
  if (extra !== undefined || version !== "v1" || !expiresRaw || !signature) return false;
  const expires = Number.parseInt(expiresRaw, 10);
  if (!Number.isFinite(expires) || expires <= nowSeconds) return false;

  const expected = await hmacSha256Hex(`v1.${expiresRaw}`);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}
