// Job handlers used by the worker. Return "rescheduled" if the handler moved the job to later.
import type { Job, JobType } from "./jobs";
import { runSearch, purgeExpiredPlaces } from "./places";
import { researchLead } from "./site/analyze";
import { runChatTest } from "./chattest";
import { sendQueuedEmail } from "./sending";
import { rescheduleJob } from "./jobs";
import { sequenceTick } from "./sequences";
import { pollReplies } from "./replies";
import { logEvent } from "./db";
import { placeCall } from "./calls";
import { sendQueuedSms } from "./sms";
import { generateEmail, latestDraft } from "./email/build";

export type Handler = (job: Job) => Promise<void | "rescheduled">;

export const handlers: Partial<Record<JobType, Handler>> = {
  search: async (job) => runSearch(String(job.payload.searchId)),
  research: async (job) => researchLead(String(job.payload.leadId)),
  chat_test: async (job) => {
    await runChatTest(String(job.payload.leadId));
  },
  send_email: async (job) => {
    const r = await sendQueuedEmail(String(job.payload.emailId));
    if (r.status === "rescheduled") {
      rescheduleJob(job.id, r.runAt, r.why);
      logEvent(null, "email", "send_deferred", `${job.payload.emailId}: ${r.why}`);
      return "rescheduled";
    }
  },
  generate_email: async (job) => {
    const leadId = String(job.payload.leadId);
    const existing = latestDraft(leadId);
    if (existing && existing.status === "draft" && existing.kind === "initial") return;
    await generateEmail(leadId);
  },
  place_call: async (job) => {
    const r = await placeCall(String(job.payload.callId));
    if (r.status === "rescheduled") {
      rescheduleJob(job.id, r.runAt, r.why);
      return "rescheduled";
    }
  },
  send_sms: async (job) => {
    const r = await sendQueuedSms(String(job.payload.smsId));
    if (r.status === "rescheduled" && r.runAt) {
      rescheduleJob(job.id, r.runAt, r.why);
      return "rescheduled";
    }
  },
  sequence_tick: async () => {
    await sequenceTick();
  },
  poll_replies: async () => {
    await pollReplies();
  },
  places_maintenance: async () => {
    purgeExpiredPlaces();
  },
};
