import { ok, bad, route } from "@/lib/api";
import { db, logEvent } from "@/lib/db";
import { setStatus, getLead } from "@/lib/leads";

export const PATCH = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { status } = await req.json();
  if (!["done", "skipped", "open"].includes(status)) return bad("Invalid status");
  const t = db().prepare("SELECT lead_id, channel FROM tasks WHERE id = ?").get(id) as { lead_id: string; channel: string } | undefined;
  if (!t) return bad("Not found", 404);
  db().prepare("UPDATE tasks SET status = ? WHERE id = ?").run(status, id);
  if (status === "done") {
    logEvent(t.lead_id, t.channel === "whatsapp" ? "whatsapp" : t.channel === "contact_form" ? "form" : "social", "sent_manually", t.channel);
    const lead = getLead(t.lead_id);
    if (lead && ["New", "Qualified"].includes(lead.status)) setStatus(t.lead_id, "Contacted", `${t.channel} (manual)`);
    db().prepare("UPDATE leads SET last_contacted_at = ? WHERE id = ?").run(new Date().toISOString(), t.lead_id);
  }
  return ok();
});
