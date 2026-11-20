import { ok, bad, route } from "@/lib/api";
import { enqueue } from "@/lib/jobs";
import { updateLead } from "@/lib/leads";
import { db } from "@/lib/db";
import { addEmailsToBatch } from "@/lib/batches";
import { addLeadsToCallBatch } from "@/lib/calls";
import { addLeadsToSmsBatch } from "@/lib/sms";
import { createTasksForLead } from "@/lib/tasks";

const summarise = (skipped: { reason: string }[]) => {
  const counts = new Map<string, number>();
  for (const s of skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
  return [...counts].map(([r, n]) => `${n}× ${r}`).join("; ");
};

export const POST = route(async (req: Request) => {
  const { action, ids } = (await req.json()) as { action: string; ids: string[] };
  if (!Array.isArray(ids) || !ids.length) return bad("Select at least one lead");
  switch (action) {
    case "research":
      for (const id of ids) {
        updateLead(id, { research_status: "pending" });
        enqueue("research", { leadId: id });
      }
      return ok({ message: `${ids.length} queued for research` });
    case "generate":
      for (const id of ids) enqueue("generate_email", { leadId: id });
      return ok({ message: `${ids.length} emails queued for writing — they appear in Outreach as drafts` });
    case "email_batch": {
      const emailIds = ids
        .map((id) => db().prepare("SELECT id FROM emails WHERE lead_id = ? AND kind = 'initial' AND status = 'draft' ORDER BY created_at DESC LIMIT 1").get(id) as { id: string } | undefined)
        .filter((r): r is { id: string } => Boolean(r))
        .map((r) => r.id);
      const missing = ids.length - emailIds.length;
      const r = addEmailsToBatch(emailIds);
      const msg = `${r.added.length} added${missing ? `; ${missing} have no draft yet` : ""}${r.skipped.length ? `; skipped: ${summarise(r.skipped)}` : ""}`;
      return ok({ message: msg, redirect: r.batchId ? `/outreach/batches/${r.batchId}` : undefined });
    }
    case "call_batch": {
      const r = await addLeadsToCallBatch(ids);
      return ok({ message: `${r.added} added${r.skipped.length ? `; skipped: ${summarise(r.skipped)}` : ""}`, redirect: r.batchId ? `/outreach/batches/${r.batchId}` : undefined });
    }
    case "sms_batch": {
      const r = addLeadsToSmsBatch(ids);
      return ok({ message: `${r.added} added${r.skipped.length ? `; skipped: ${summarise(r.skipped)}` : ""}`, redirect: r.batchId ? `/outreach/batches/${r.batchId}` : undefined });
    }
    case "tasks": {
      const n = ids.reduce((sum, id) => sum + createTasksForLead(id), 0);
      return ok({ message: `${n} manual task(s) created — see Outreach → Manual tasks` });
    }
    default:
      return bad("Unknown action");
  }
});
