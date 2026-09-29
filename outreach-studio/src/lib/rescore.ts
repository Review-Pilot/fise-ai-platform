// Re-applies the qualification thresholds to every researched lead (no re-crawl).
import { db } from "./db";
import { rowToLead, updateLead, setStatus } from "./leads";
import { getCachedPlace } from "./places";
import { getSettings } from "./settings";
import { qualify } from "./qualify";

export function rescoreAll(): { qualified: number; excluded: number } {
  const q = getSettings().qualification;
  let qualified = 0;
  let excluded = 0;
  const rows = db().prepare("SELECT * FROM leads WHERE research_status = 'done'").all() as Record<string, unknown>[];
  for (const row of rows) {
    const lead = rowToLead(row);
    const r = qualify(
      {
        businessName: lead.business_name,
        research: lead.research,
        place: lead.place_id ? getCachedPlace(lead.place_id) : null,
        contacts: lead.contacts,
        locations: lead.locations,
        isManual: lead.source !== "places",
      },
      q,
    );
    updateLead(lead.id, { qualified: r.qualified ? 1 : 0, disqualify_reason: r.disqualifyReason, fit_score: r.score, fit_reason: r.reason });
    if (r.qualified && lead.status === "New") setStatus(lead.id, "Qualified", "re-score");
    if (!r.qualified && lead.status === "Qualified") setStatus(lead.id, "New", "re-score");
    if (r.qualified) qualified++;
    else excluded++;
  }
  return { qualified, excluded };
}
