// Background worker: processes the SQLite job queue and runs periodic tasks.
// Start with `npm run worker` alongside `npm run dev`.
import nextEnv from "@next/env";
import type { Job } from "../src/lib/jobs";

nextEnv.loadEnvConfig(process.cwd());

const { claimNext, completeJob, failJob, enqueue, recoverStuckJobs, hasQueuedJob } = await import("../src/lib/jobs");
const { handlers } = await import("../src/lib/handlers");

recoverStuckJobs();

// Periodic jobs (only enqueued if not already pending).
const PERIODIC: { type: Job["type"]; everyMs: number }[] = [
  { type: "sequence_tick", everyMs: 15 * 60_000 },
  { type: "poll_replies", everyMs: 10 * 60_000 },
  { type: "places_maintenance", everyMs: 6 * 3600_000 },
];
const lastRun = new Map<string, number>();
function schedulePeriodic() {
  for (const p of PERIODIC) {
    if (Date.now() - (lastRun.get(p.type) ?? 0) < p.everyMs) continue;
    lastRun.set(p.type, Date.now());
    if (!hasQueuedJob(p.type, "periodic", "1")) enqueue(p.type, { periodic: "1" });
  }
}

let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

console.log("[worker] started");
while (!stopping) {
  schedulePeriodic();
  const job = claimNext();
  if (!job) {
    await new Promise((r) => setTimeout(r, 2000));
    continue;
  }
  const started = Date.now();
  try {
    const handler = handlers[job.type];
    if (!handler) throw new Error(`No handler for job type ${job.type}`);
    const result = await handler(job);
    if (result !== "rescheduled") completeJob(job.id);
    console.log(`[worker] ${job.type}#${job.id} ${result ?? "done"} in ${Date.now() - started}ms`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[worker] ${job.type}#${job.id} failed: ${msg}`);
    failJob(job, msg);
  }
}
console.log("[worker] stopped");
process.exit(0);
