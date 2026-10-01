// A tiny SQLite-backed job queue. The Next.js app enqueues; `npm run worker` processes.
import { db, now } from "./db";

export type JobType =
  | "search"
  | "research"
  | "chat_test"
  | "generate_email"
  | "send_email"
  | "place_call"
  | "send_sms"
  | "sequence_tick"
  | "poll_replies"
  | "build_demo"
  | "places_maintenance";

export interface Job {
  id: number;
  type: JobType;
  payload: Record<string, unknown>;
  run_at: string;
  status: string;
  attempts: number;
  last_error: string | null;
}

export function enqueue(type: JobType, payload: Record<string, unknown> = {}, runAt: Date = new Date()): number {
  const t = now();
  const res = db()
    .prepare(
      "INSERT INTO jobs (type, payload, run_at, status, created_at, updated_at) VALUES (?, ?, ?, 'queued', ?, ?)",
    )
    .run(type, JSON.stringify(payload), runAt.toISOString(), t, t);
  return Number(res.lastInsertRowid);
}

/** Atomically claims the next due job. */
export function claimNext(): Job | null {
  const d = db();
  const tx = d.transaction(() => {
    const row = d
      .prepare("SELECT * FROM jobs WHERE status = 'queued' AND run_at <= ? ORDER BY run_at, id LIMIT 1")
      .get(now()) as (Omit<Job, "payload"> & { payload: string }) | undefined;
    if (!row) return null;
    d.prepare("UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ?").run(
      now(),
      row.id,
    );
    return { ...row, payload: JSON.parse(row.payload), attempts: row.attempts + 1 } as Job;
  });
  return tx();
}

export function completeJob(id: number) {
  db().prepare("UPDATE jobs SET status = 'done', updated_at = ? WHERE id = ?").run(now(), id);
}

export function rescheduleJob(id: number, runAt: Date, note?: string) {
  db()
    .prepare("UPDATE jobs SET status = 'queued', run_at = ?, attempts = attempts - 1, last_error = ?, updated_at = ? WHERE id = ?")
    .run(runAt.toISOString(), note ?? null, now(), id);
}

export function failJob(job: Job, error: string, maxAttempts = 3) {
  const retry = job.attempts < maxAttempts;
  const backoff = new Date(Date.now() + 60_000 * 2 ** job.attempts);
  db()
    .prepare("UPDATE jobs SET status = ?, run_at = ?, last_error = ?, updated_at = ? WHERE id = ?")
    .run(retry ? "queued" : "failed", backoff.toISOString(), error.slice(0, 2000), now(), job.id);
}

export function pendingJobs(type?: JobType): number {
  const row = type
    ? db().prepare("SELECT COUNT(*) c FROM jobs WHERE status IN ('queued','running') AND type = ?").get(type)
    : db().prepare("SELECT COUNT(*) c FROM jobs WHERE status IN ('queued','running')").get();
  return (row as { c: number }).c;
}

export function hasQueuedJob(type: JobType, key: string, value: string): boolean {
  const row = db()
    .prepare(
      `SELECT 1 FROM jobs WHERE type = ? AND status IN ('queued','running') AND json_extract(payload, '$.' || ?) = ? LIMIT 1`,
    )
    .get(type, key, value);
  return Boolean(row);
}

/** Jobs left 'running' by a crashed worker go back to the queue on startup. */
export function recoverStuckJobs() {
  db()
    .prepare("UPDATE jobs SET status = 'queued', updated_at = ? WHERE status = 'running'")
    .run(now());
}
