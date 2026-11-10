import { db, newId, now, parseJson, logEvent } from "./db";
import type { Lead, LeadStatus } from "./types";

const JSON_COLS = ["research", "contacts", "colors", "chat_test"] as const;

export function rowToLead(row: Record<string, unknown>): Lead {
  return {
    ...(row as unknown as Lead),
    research: parseJson(row.research, null),
    contacts: parseJson(row.contacts, []),
    colors: parseJson(row.colors, null),
    chat_test: parseJson(row.chat_test, null),
  };
}

export function getLead(id: string): Lead | null {
  const row = db().prepare("SELECT * FROM leads WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToLead(row) : null;
}

export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function normaliseWebsite(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = "";
    // Drop tracking params Google adds (utm_*), keep the rest.
    for (const k of [...u.searchParams.keys()]) if (k.startsWith("utm_")) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return null;
  }
}

export interface NewLeadInput {
  business_name: string;
  website?: string | null;
  source?: string;
  place_id?: string | null;
  search_id?: string | null;
  city?: string | null;
  keyword?: string | null;
  contact_first_name?: string | null;
  notes?: string | null;
  email?: string | null;
}

export function createLead(input: NewLeadInput): Lead {
  const id = newId("lead");
  const website = normaliseWebsite(input.website);
  const t = now();
  const contacts = input.email
    ? [
        {
          kind: "email",
          value: input.email.trim().toLowerCase(),
          sourceUrl: "manual entry",
          foundAt: t,
          emailType: "named",
          personName: input.contact_first_name ?? undefined,
        },
      ]
    : [];
  db()
    .prepare(
      `INSERT INTO leads (id, source, place_id, search_id, business_name, contact_first_name, website, domain,
        city, keyword, notes, contacts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.source ?? "manual",
      input.place_id ?? null,
      input.search_id ?? null,
      input.business_name.trim(),
      input.contact_first_name?.trim() || null,
      website,
      domainOf(website),
      input.city ?? null,
      input.keyword ?? null,
      input.notes ?? null,
      JSON.stringify(contacts),
      t,
      t,
    );
  logEvent(id, "system", "lead_created", input.source ?? "manual");
  return getLead(id)!;
}

type Patch = Partial<Omit<Lead, "id" | "created_at">>;

export function updateLead(id: string, patch: Patch): Lead | null {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (!entries.length) return getLead(id);
  const cols = entries.map(([k]) => `${k} = ?`).join(", ");
  const values = entries.map(([k, v]) =>
    (JSON_COLS as readonly string[]).includes(k) ? (v === null ? null : JSON.stringify(v)) : v,
  );
  db()
    .prepare(`UPDATE leads SET ${cols}, updated_at = ? WHERE id = ?`)
    .run(...(values as (string | number | null)[]), now(), id);
  return getLead(id);
}

export function setStatus(id: string, status: LeadStatus, why?: string) {
  const lead = getLead(id);
  if (!lead || lead.status === status) return;
  // "Do not contact" is sticky — nothing automatic may move a lead out of it.
  if (lead.status === "Do not contact" && why !== "manual") return;
  updateLead(id, { status });
  logEvent(id, "system", "status", `${lead.status} → ${status}${why ? ` (${why})` : ""}`);
}

export interface LeadFilters {
  city?: string;
  industry?: string;
  status?: string;
  minScore?: number;
  hasChatbot?: "yes" | "no" | "";
  qualified?: "yes" | "no" | "pending" | "";
  q?: string;
  search?: string;
}

export function listLeads(filters: LeadFilters = {}, limit = 500): Lead[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (filters.city) {
    where.push("city LIKE ?");
    args.push(`%${filters.city}%`);
  }
  if (filters.industry) {
    where.push("(industry LIKE ? OR keyword LIKE ?)");
    args.push(`%${filters.industry}%`, `%${filters.industry}%`);
  }
  if (filters.status) {
    where.push("status = ?");
    args.push(filters.status);
  }
  if (filters.minScore) {
    where.push("fit_score >= ?");
    args.push(filters.minScore);
  }
  if (filters.hasChatbot === "yes") where.push("has_chatbot = 1");
  if (filters.hasChatbot === "no") where.push("(has_chatbot = 0 OR has_chatbot IS NULL)");
  if (filters.qualified === "yes") where.push("qualified = 1");
  if (filters.qualified === "no") where.push("qualified = 0");
  if (filters.qualified === "pending") where.push("qualified IS NULL");
  if (filters.search) {
    where.push("search_id = ?");
    args.push(filters.search);
  }
  if (filters.q) {
    where.push("(business_name LIKE ? OR domain LIKE ?)");
    args.push(`%${filters.q}%`, `%${filters.q}%`);
  }
  const sql = `SELECT * FROM leads ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY COALESCE(fit_score, -1) DESC, created_at DESC LIMIT ?`;
  return (db().prepare(sql).all(...args, limit) as Record<string, unknown>[]).map(rowToLead);
}

/** Right to erasure: removes the lead and everything linked to it. Keeps only a DNC entry if one exists. */
export function eraseLead(id: string) {
  const d = db();
  const tx = d.transaction(() => {
    d.prepare("DELETE FROM emails WHERE lead_id = ?").run(id);
    d.prepare("DELETE FROM calls WHERE lead_id = ?").run(id);
    d.prepare("DELETE FROM sms WHERE lead_id = ?").run(id);
    d.prepare("DELETE FROM tasks WHERE lead_id = ?").run(id);
    d.prepare("DELETE FROM sequences WHERE lead_id = ?").run(id);
    d.prepare("DELETE FROM events WHERE lead_id = ?").run(id);
    const lead = d.prepare("SELECT place_id FROM leads WHERE id = ?").get(id) as { place_id?: string } | undefined;
    if (lead?.place_id) d.prepare("DELETE FROM place_cache WHERE place_id = ?").run(lead.place_id);
    d.prepare("DELETE FROM leads WHERE id = ?").run(id);
  });
  tx();
  logEvent(null, "system", "erasure", `Lead ${id} erased on request`);
}
