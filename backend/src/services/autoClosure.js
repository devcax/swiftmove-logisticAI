const workflow = require('./workflow');
const bot = require('./bot');

const SWEEP_MS = Number(process.env.AUTO_CLOSURE_SWEEP_MS ?? 30_000);

async function sweepOnce() {
  const dueIds = await workflow.findJobsDueForAutoClosure();
  for (const jobId of dueIds) {
    try {
      const { job, driver, alreadyRequested } = await workflow.requestClosureAuto(jobId);
      if (alreadyRequested) continue;
      if (driver) {
        await bot.notifyDriver({
          job,
          driver,
          body: `The delivery on *${job.job_number}* is complete, so I've sent the job to the manager for closure approval. You don't need to do anything else.`,
        });
      }
      console.log(`Auto-closure: ${job.job_number} sent for closure approval`);
    } catch (err) {
      console.error(`Auto-closure failed for job ${jobId}:`, err.message);
    }
  }
  return dueIds.length;
}

/** Start the periodic sweep. Returns the timer so tests/shutdown can stop it. */
function startAutoClosureSweep() {
  const timer = setInterval(() => {
    sweepOnce().catch((err) => console.error('Auto-closure sweep failed:', err.message));
  }, SWEEP_MS);
  timer.unref();
  return timer;
}

module.exports = { sweepOnce, startAutoClosureSweep };
