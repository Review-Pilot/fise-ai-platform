// One opt-out routine for every channel: unsubscribe link, "remove me" on a call, STOP by SMS,
// or an unsubscribe reply. Blocks the lead everywhere and cancels anything queued.
import { db, now, logEvent } from "./db";
import { addDnc } from "./dnc";
import { getLead, setStatus, updateLead } from "./leads";
import { stopSequence } from "./sequences";

export function optOut(opts: { leadId?: string | null; email?: string | null; phone?: string | null; channel: string; reason: string }) {
  if (opts.email) addDnc(opts.email, opts.reason, opts.channel, opts.leadId);
  if (opts.phone) addDnc(opts.phone, opts.reason, opts.channel, opts.leadId);
  const lead = opts.leadId ? getLead(opts.leadId) : null;
  if (!lead) return;
  for (const c of lead.contacts) {
    if (c.kind === "email" || c.kind === "phone" || c.kind === "whatsapp") addDnc(c.value, opts.reason, opts.channel, lead.id);
  }
  setStatus(lead.id, "Do not contact", opts.channel);
  updateLead(lead.id, { consent_status: "refused" });
  stopSequence(lead.id, opts.reason);
  const d = db();
  d.prepare("UPDATE emails SET status = 'cancelled', updated_at = ? WHERE lead_id = ? AND status IN ('draft','queued')").run(now(), lead.id);
  d.prepare("UPDATE calls SET status = 'cancelled' WHERE lead_id = ? AND status IN ('pending','queued')").run(lead.id);
  d.prepare("UPDATE sms SET status = 'cancelled' WHERE lead_id = ? AND status IN ('pending','queued')").run(lead.id);
  d.prepare("UPDATE tasks SET status = 'skipped' WHERE lead_id = ? AND status = 'open'").run(lead.id);
  logEvent(lead.id, opts.channel, "opt_out", opts.reason);
}
