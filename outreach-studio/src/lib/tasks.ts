// Manual tasks for channels we never automate (WhatsApp without opt-in, contact forms, social DMs).
import { db, newId, now } from "./db";
import { getLead } from "./leads";
import { latestDraft } from "./email/build";
import { isBlocked } from "./dnc";

export function createTasksForLead(leadId: string): number {
  const lead = getLead(leadId);
  const draft = latestDraft(leadId);
  if (!lead || !draft || lead.status === "Do not contact") return 0;
  const existing = new Set(
    (db().prepare("SELECT channel FROM tasks WHERE lead_id = ? AND status = 'open'").all(leadId) as { channel: string }[]).map((r) => r.channel),
  );
  const add = (channel: string, message: string, url: string | null) => {
    if (existing.has(channel)) return 0;
    db().prepare("INSERT INTO tasks (id, lead_id, channel, message, url, status, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)").run(newId("task"), leadId, channel, message, url, now());
    return 1;
  };
  let n = 0;
  const wa = lead.contacts.find((c) => c.kind === "whatsapp");
  if (wa && !isBlocked({ phone: wa.value })) {
    n += add("whatsapp", draft.copy.whatsappMessage, `https://wa.me/${wa.value.replace(/\D/g, "")}?text=${encodeURIComponent(draft.copy.whatsappMessage)}`);
  }
  const form = lead.contacts.find((c) => c.kind === "contact_form");
  if (form) n += add("contact_form", draft.copy.contactFormMessage, form.value);
  for (const kind of ["linkedin", "facebook", "instagram"] as const) {
    const s = lead.contacts.find((c) => c.kind === kind);
    if (s) n += add(kind, draft.copy.socialMessage, s.value);
  }
  return n;
}

export function listOpenTasks(limit = 200) {
  return db()
    .prepare("SELECT t.*, l.business_name FROM tasks t JOIN leads l ON l.id = t.lead_id WHERE t.status = 'open' ORDER BY t.created_at DESC LIMIT ?")
    .all(limit) as { id: string; lead_id: string; channel: string; message: string; url: string | null; business_name: string; created_at: string }[];
}
