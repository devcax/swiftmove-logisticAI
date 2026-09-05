// Job schedules are stored as TIMESTAMPTZ, i.e. real instants. A client must
// therefore send an instant with an explicit zone ("...Z" or "+05:30"). A bare
// "YYYY-MM-DDTHH:mm" from a datetime-local input carries no zone at all, and
// `new Date()` would read it in the *process* timezone - UTC inside the
// container - so a time picked at 10:00 would be stored as 10:00Z and read back
// as 15:30 for the user. Anchor such wall-clock strings to APP_TIMEZONE, which
// is also the zone every outbound WhatsApp message is formatted in.
const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Colombo';

const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;
const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

// How far the given zone is ahead of UTC at that instant, in milliseconds.
function zoneOffsetMs(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const f = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(f.year),
    Number(f.month) - 1,
    Number(f.day),
    Number(f.hour) % 24,
    Number(f.minute),
    Number(f.second)
  );
  return asUtc - instant.getTime();
}

// Parses a client-supplied timestamp into a Date, or null when unusable.
function parseInstant(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  if (HAS_ZONE.test(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const m = WALL_CLOCK.exec(raw);
  if (!m) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0);
  if (Number.isNaN(wall)) return null;
  // The offset depends on the instant we are solving for, so settle it twice;
  // the second pass lands on the right side of any DST change.
  let instant = new Date(wall - zoneOffsetMs(new Date(wall), APP_TIMEZONE));
  instant = new Date(wall - zoneOffsetMs(instant, APP_TIMEZONE));
  return Number.isNaN(instant.getTime()) ? null : instant;
}

// Formats a stored instant for humans, always in the business timezone.
function formatWhen(value, options = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('en-GB', { timeZone: APP_TIMEZONE, ...options });
}

module.exports = { APP_TIMEZONE, parseInstant, formatWhen };
