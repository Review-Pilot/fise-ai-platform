import { ok, bad, route } from "@/lib/api";
import { getLead, updateLead, setStatus, eraseLead } from "@/lib/leads";
import { enqueue } from "@/lib/jobs";
import { addDnc } from "@/lib/dnc";
import { finalisePalette, parseColor } from "@/lib/color";
import { refreshPlace } from "@/lib/places";
import { createDemoChatbot } from "@/lib/fisedemo";
import { refreshComparison } from "@/lib/site/analyze";
import { logEvent } from "@/lib/db";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/types";
import { stopSequence } from "@/lib/sequences";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const lead = getLead(id);
  if (!lead) return bad("Lead not found", 404);
  const b = await req.json();
  if (b.status) {
    if (!LEAD_STATUSES.includes(b.status)) return bad("Unknown status");
    if (b.status === "Do not contact") blockLead(id, "Marked do-not-contact manually");
    setStatus(id, b.status as LeadStatus, "manual");
    if (["Replied", "Demo booked", "Won", "Lost", "Do not contact"].includes(b.status)) stopSequence(id, `status: ${b.status}`);
  }
  if (typeof b.notes === "string") updateLead(id, { notes: b.notes });
  if (typeof b.contact_first_name === "string") updateLead(id, { contact_first_name: b.contact_first_name.trim() || null });
  if (b.consent_status && ["none", "requested", "granted", "refused"].includes(b.consent_status)) {
    updateLead(id, { consent_status: b.consent_status });
    logEvent(id, "system", "consent", b.consent_status);
    if (b.consent_status === "refused") {
      blockLead(id, "Refused consent");
      setStatus(id, "Do not contact", "manual");
    }
  }
  if (b.colors) {
    const { primary, secondary, accent } = b.colors;
    if (![primary, secondary, accent].every((c) => typeof c === "string" && parseColor(c))) return bad("Invalid colour");
    updateLead(id, { colors: finalisePalette(primary, secondary, accent, "manual", ["Set manually"]) });
  }
  if (typeof b.chat_test_approved === "boolean") {
    updateLead(id, { chat_test_approved: b.chat_test_approved ? 1 : 0 });
    logEvent(id, "system", "chat_test_approval", b.chat_test_approved ? "approved" : "revoked");
  }
  return ok({ lead: getLead(id) });
});

function blockLead(id: string, reason: string) {
  const lead = getLead(id);
  if (!lead) return;
  for (const c of lead.contacts) {
    if (c.kind === "email" || c.kind === "phone" || c.kind === "whatsapp") addDnc(c.value, reason, "lead page", id);
  }
  if (lead.domain) addDnc(lead.domain, reason, "lead page", id);
}

export const POST = route(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const lead = getLead(id);
  if (!lead) return bad("Lead not found", 404);
  const { action } = await req.json();
  switch (action) {
    case "research":
      updateLead(id, { research_status: "pending" });
      enqueue("research", { leadId: id });
      return ok({ message: "Research queued" });
    case "chat_test":
      if (!lead.chat_test_approved) return bad("Approve the chat test for this lead first");
      enqueue("chat_test", { leadId: id });
      return ok({ message: "Chat test queued — one question will be sent" });
    case "comparison":
      await refreshComparison(id);
      return ok({ message: "Comparison rewritten" });
    case "refresh_place":
      if (!lead.place_id) return bad("Lead did not come from Google Places");
      await refreshPlace(lead.place_id);
      return ok({ message: "Google data refreshed" });
    case "create_demo":
      return ok({ message: "Demo chatbot created", link: await createDemoChatbot(id) });
    case "dnc":
      blockLead(id, "Marked do-not-contact manually");
      setStatus(id, "Do not contact", "manual");
      stopSequence(id, "do not contact");
      return ok({ message: "Added to do-not-contact list" });
    case "erase":
      eraseLead(id);
      return ok({ message: "All data for this lead was deleted", redirect: "/leads" });
    case "erase_and_block":
      blockLead(id, "Erasure request — do not contact again");
      eraseLead(id);
      return ok({ message: "Data deleted; contact details kept only on the do-not-contact list", redirect: "/leads" });
    default:
      return bad("Unknown action");
  }
});
