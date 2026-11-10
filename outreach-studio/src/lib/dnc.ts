// Global do-not-contact list, shared by every channel.
import { db, now, logEvent } from "./db";

export type DncKind = "email" | "phone" | "domain";

/** Normalises SA and international numbers to E.164 (+27...). Returns null if it doesn't look like a phone. */
export function normalisePhone(raw: string): string | null {
  let s = raw.replace(/[^\d+]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (s.startsWith("0") && s.length === 10) s = `+27${s.slice(1)}`;
  if (/^27\d{9}$/.test(s)) s = `+${s}`;
  if (!/^\+\d{9,15}$/.test(s)) return null;
  return s;
}

export function normaliseDnc(value: string): { kind: DncKind; value: string } | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  if (v.includes("@")) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? { kind: "email", value: v } : null;
  const phone = normalisePhone(v);
  if (phone && /\d{9,}/.test(v.replace(/\D/g, ""))) return { kind: "phone", value: phone };
  const domain = v.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return { kind: "domain", value: domain };
  return null;
}

export function addDnc(raw: string, reason: string, source: string, leadId?: string | null): boolean {
  const n = normaliseDnc(raw);
  if (!n) return false;
  db()
    .prepare("INSERT OR IGNORE INTO dnc (value, kind, reason, source, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(n.value, n.kind, reason, source, now());
  logEvent(leadId ?? null, "system", "dnc_added", `${n.kind}: ${n.value} (${reason})`);
  return true;
}

export function removeDnc(value: string) {
  db().prepare("DELETE FROM dnc WHERE value = ?").run(value);
}

/** True if the email, its domain, or the phone number is on the list. */
export function isBlocked(opts: { email?: string | null; phone?: string | null; domain?: string | null }): string | null {
  const checks: string[] = [];
  if (opts.email) {
    const e = opts.email.trim().toLowerCase();
    checks.push(e, e.split("@")[1] ?? "");
  }
  if (opts.phone) {
    const p = normalisePhone(opts.phone);
    if (p) checks.push(p);
  }
  if (opts.domain) checks.push(opts.domain.toLowerCase().replace(/^www\./, ""));
  const stmt = db().prepare("SELECT value, reason FROM dnc WHERE value = ?");
  for (const c of checks.filter(Boolean)) {
    const hit = stmt.get(c) as { value: string; reason: string } | undefined;
    if (hit) return `${hit.value} is on the do-not-contact list (${hit.reason ?? "no reason"})`;
  }
  return null;
}

export function importDnc(text: string, source = "import"): { added: number; skipped: number } {
  let added = 0;
  let skipped = 0;
  for (const cell of text.split(/[\n,;\t]+/)) {
    if (!cell.trim() || /^(email|phone|value)$/i.test(cell.trim())) continue;
    if (addDnc(cell, "imported opt-out", source)) added++;
    else skipped++;
  }
  return { added, skipped };
}

export function listDnc(limit = 1000) {
  return db().prepare("SELECT * FROM dnc ORDER BY created_at DESC LIMIT ?").all(limit) as {
    value: string;
    kind: DncKind;
    reason: string | null;
    source: string | null;
    created_at: string;
  }[];
}
