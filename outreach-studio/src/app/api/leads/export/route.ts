import { listLeads, type LeadFilters } from "@/lib/leads";
import { bestEmail } from "@/lib/site/contacts";

const esc = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Neutralise spreadsheet formulas (CSV injection) and quote.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

export async function GET(req: Request) {
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const leads = listLeads(
    {
      city: sp.city, industry: sp.industry, status: sp.status, q: sp.q, search: sp.search,
      minScore: sp.minScore ? Number(sp.minScore) : undefined,
      hasChatbot: (sp.hasChatbot as LeadFilters["hasChatbot"]) ?? "",
      qualified: (sp.qualified as LeadFilters["qualified"]) ?? "",
    },
    100000,
  );
  const header = ["business_name", "website", "city", "industry", "status", "fit_score", "fit_reason", "platform", "can_install",
    "has_chat", "chat_tools", "best_route", "best_email", "email_source", "phone", "owner_name", "consent_status", "last_contacted_at", "created_at"];
  const rows = leads.map((l) => {
    const email = bestEmail(l.contacts);
    const phone = l.contacts.find((c) => c.kind === "phone");
    return [l.business_name, l.website, l.city, l.industry, l.status, l.fit_score, l.fit_reason, l.platform, l.can_install,
      l.has_chatbot ? "yes" : "no", l.research?.chatTools.map((t) => t.name).join("; "), l.best_route, email?.value, email?.sourceUrl,
      phone?.value, l.research?.ownerName, l.consent_status, l.last_contacted_at, l.created_at].map(esc).join(",");
  });
  return new Response([header.join(","), ...rows].join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="fise-leads-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
