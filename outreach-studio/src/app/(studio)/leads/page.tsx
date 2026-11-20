import Link from "next/link";
import { listLeads, type LeadFilters } from "@/lib/leads";
import { LEAD_STATUSES } from "@/lib/types";
import { pendingJobs } from "@/lib/jobs";
import { LeadTable } from "./LeadTable";
import { AutoRefresh } from "@/components/AutoRefresh";

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const filters: LeadFilters = {
    city: sp.city, industry: sp.industry, status: sp.status, q: sp.q, search: sp.search,
    minScore: sp.minScore ? Number(sp.minScore) : undefined,
    hasChatbot: (sp.hasChatbot as LeadFilters["hasChatbot"]) ?? "",
    qualified: (sp.qualified as LeadFilters["qualified"]) ?? (sp.all ? "" : "yes"),
  };
  const leads = listLeads(filters);
  const queue = pendingJobs("research");
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v)).toString();
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="h1">Leads</h1>
          <p className="muted">{leads.length} shown{queue ? ` · ${queue} being researched` : ""}</p>
        </div>
        <div className="flex gap-2">
          {queue > 0 && <AutoRefresh seconds={6} />}
          <a className="btn-secondary" href={`/api/leads/export?${qs}`}>Export CSV</a>
          <Link className="btn-primary" href="/outreach/new">Add prospect</Link>
        </div>
      </div>
      <form className="card grid grid-cols-2 gap-3 md:grid-cols-7" method="get">
        <input className="input" name="q" placeholder="Search name/domain" defaultValue={sp.q} />
        <input className="input" name="city" placeholder="City" defaultValue={sp.city} />
        <input className="input" name="industry" placeholder="Industry" defaultValue={sp.industry} />
        <select className="input" name="status" defaultValue={sp.status ?? ""}>
          <option value="">Any status</option>
          {LEAD_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select className="input" name="qualified" defaultValue={filters.qualified}>
          <option value="yes">Qualified only</option>
          <option value="no">Excluded only</option>
          <option value="pending">Not yet researched</option>
          <option value="">All leads</option>
        </select>
        <select className="input" name="hasChatbot" defaultValue={sp.hasChatbot ?? ""}>
          <option value="">Chat: any</option>
          <option value="no">No chat widget</option>
          <option value="yes">Has chat widget</option>
        </select>
        <div className="flex gap-2">
          <input className="input" name="minScore" type="number" min={0} max={100} placeholder="Min score" defaultValue={sp.minScore} />
          <button className="btn-secondary">Filter</button>
        </div>
        {sp.search && <input type="hidden" name="search" value={sp.search} />}
      </form>
      <LeadTable
        leads={leads.map((l) => ({
          id: l.id, name: l.business_name, domain: l.domain, city: l.city, industry: l.industry ?? l.keyword,
          score: l.fit_score, reason: l.fit_reason, status: l.status, platform: l.platform, route: l.best_route,
          hasChat: l.has_chatbot, research: l.research_status, excluded: l.qualified === 0 ? l.disqualify_reason : null,
        }))}
      />
    </div>
  );
}
