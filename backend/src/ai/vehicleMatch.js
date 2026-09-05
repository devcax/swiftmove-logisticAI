const { chatJson } = require('./groq');

const MATCH_SYSTEM = `You are the dispatch planner of a trucking company. When a new job is published you receive the job's cargo and the available drivers with the vehicle each one registered at onboarding.

Decide which drivers can physically carry this cargo with their vehicle:
- Compare the cargo unit and quantity against what that vehicle type can typically carry. A small van cannot carry 18 tons or a 40ft container; a prime mover or large lorry can. A car or bike can only take a few small boxes.
- Pallets, boxes, tons, units and containers imply different capacity and vehicle-class needs. Container cargo needs a container-capable truck.
- When the vehicle is clearly too small or the wrong kind for the cargo, leave the driver out. When in doubt, leave the driver out.
- fit is "good" when the vehicle is plainly right for the load, "tight" when it should just about manage.

Reply with JSON only, nothing else:
{"matches":[{"driver_id":"...","fit":"good","reason":"max 10 words"}]}
Include only drivers that can take the job. If nobody fits: {"matches":[]}.`;

function parseMatches(raw, candidateIds) {
  const list = Array.isArray(raw?.matches) ? raw.matches : [];
  const seen = new Set();
  const out = [];
  for (const m of list) {
    const id = String(m?.driver_id ?? '');
    if (!candidateIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({
      driver_id: id,
      fit: m?.fit === 'tight' ? 'tight' : 'good',
      reason: String(m?.reason ?? '').trim().slice(0, 120) || null,
    });
  }
  return out;
}

async function matchDriversForJob({ job, items = [], drivers }) {
  if (!drivers?.length) return [];

  const user = JSON.stringify({
    job: {
      number: job.job_number,
      cargo: job.cargo_description,
      pickup: job.pickup ?? null,
      delivery: job.delivery ?? null,
      items: items.map((i) => ({
        description: i.description,
        quantity: Number(i.planned_quantity),
        unit: i.unit,
      })),
    },
    drivers: drivers.map((d) => ({ driver_id: d.id, name: d.name, vehicle: d.vehicle_type })),
  });

  try {
    const raw = await chatJson({ system: MATCH_SYSTEM, user, maxTokens: 500 });
    return parseMatches(raw, new Set(drivers.map((d) => d.id)));
  } catch (err) {
    console.error(`Vehicle match failed for ${job.job_number}, offering to all ${drivers.length} available drivers:`, err.message);
    return drivers.map((d) => ({ driver_id: d.id, fit: 'unchecked', reason: null }));
  }
}

async function filterJobsForDriver(driver, jobs) {
  const list = jobs ?? [];
  const vehicle = String(driver?.vehicle_type ?? '').trim();
  if (!vehicle || list.length === 0) return list;
  const checks = await Promise.all(
    list.map(async (job) => {
      const matches = await matchDriversForJob({
        job,
        items: [{ description: job.cargo_description, planned_quantity: job.quantity, unit: job.unit }],
        drivers: [{ id: driver.id, name: driver.name, vehicle_type: vehicle }],
      });
      return matches.length > 0;
    })
  );
  return list.filter((_, i) => checks[i]);
}

module.exports = { matchDriversForJob, parseMatches, filterJobsForDriver };
