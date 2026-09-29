// Single-prospect flow: create → research website → generate the first email draft.
import { ok, bad, route } from "@/lib/api";
import { createLead, getLead, domainOf } from "@/lib/leads";
import { researchLead } from "@/lib/site/analyze";
import { generateEmail } from "@/lib/email/build";
import { db } from "@/lib/db";

export const maxDuration = 120;

export const POST = route(async (req: Request) => {
  const b = await req.json();
  const name = String(b.business_name ?? "").trim();
  const email = String(b.email ?? "").trim().toLowerCase();
  if (!name) return bad("Business name is required");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return bad("That email address doesn't look right");
  const domain = domainOf(b.website);
  if (domain) {
    const existing = db().prepare("SELECT id FROM leads WHERE domain = ?").get(domain) as { id: string } | undefined;
    if (existing) return ok({ leadId: existing.id, existing: true });
  }
  const lead = createLead({
    business_name: name,
    website: b.website,
    email: email || null,
    contact_first_name: b.first_name,
    notes: b.notes,
    source: "manual",
  });
  if (email && b.email_source) {
    const l = getLead(lead.id)!;
    db().prepare("UPDATE leads SET contacts = ? WHERE id = ?").run(
      JSON.stringify(l.contacts.map((c) => (c.value === email ? { ...c, sourceUrl: String(b.email_source).slice(0, 200) } : c))),
      lead.id,
    );
  }
  await researchLead(lead.id);
  const { email: draft } = await generateEmail(lead.id);
  return ok({ leadId: lead.id, emailId: draft.id });
});
