// SQLite storage (single file, WAL mode so the Next.js app and the worker can share it).
import type { DatabaseSync, StatementSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'manual',        -- places | manual | import
  place_id TEXT,
  search_id TEXT,
  business_name TEXT NOT NULL,
  contact_first_name TEXT,
  website TEXT,
  domain TEXT,
  city TEXT,
  keyword TEXT,
  industry TEXT,
  locations INTEGER NOT NULL DEFAULT 1,       -- same website seen on N Google listings
  status TEXT NOT NULL DEFAULT 'New',
  qualified INTEGER,                             -- null = not yet checked
  disqualify_reason TEXT,
  fit_score INTEGER,
  fit_reason TEXT,
  platform TEXT,
  can_install TEXT,                              -- yes | likely | no
  has_chatbot INTEGER,
  best_route TEXT,
  research_status TEXT NOT NULL DEFAULT 'pending', -- pending | running | done | failed
  research_error TEXT,
  research JSON,                                 -- SiteResearch blob
  contacts JSON,                                 -- ContactDetail[]
  colors JSON,                                   -- BrandColors
  chat_test_approved INTEGER NOT NULL DEFAULT 0,
  chat_test JSON,
  comparison TEXT,
  notes TEXT,
  consent_status TEXT NOT NULL DEFAULT 'none',   -- none | requested | granted | refused
  demo_chat_link TEXT,
  landing_slug TEXT UNIQUE,
  last_contacted_at TEXT,
  replied_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS leads_status ON leads(status);
CREATE UNIQUE INDEX IF NOT EXISTS leads_place ON leads(place_id) WHERE place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS leads_domain ON leads(domain);

-- Google Places content is cached only temporarily (see places.ts); place_id is kept on the lead.
CREATE TABLE IF NOT EXISTS place_cache (
  place_id TEXT PRIMARY KEY,
  data JSON NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS searches (
  id TEXT PRIMARY KEY,
  keywords JSON NOT NULL,
  cities JSON NOT NULL,
  radius_km REAL NOT NULL,
  max_pages INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  est_cost REAL NOT NULL DEFAULT 0,
  actual_cost REAL NOT NULL DEFAULT 0,
  found INTEGER NOT NULL DEFAULT 0,
  added INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service TEXT NOT NULL,           -- places_text | places_details | claude | vapi
  units REAL NOT NULL,
  cost REAL NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'initial',  -- initial | followup1 | followup2
  to_email TEXT,
  subject TEXT,
  preheader TEXT,
  copy JSON,
  html TEXT,
  text TEXT,
  image_file TEXT,
  checks JSON,
  status TEXT NOT NULL DEFAULT 'draft',  -- draft | queued | sent | failed | blocked | cancelled
  batch_id TEXT,
  provider_id TEXT,
  error TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS emails_lead ON emails(lead_id);
CREATE INDEX IF NOT EXISTS emails_status ON emails(status);

CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,                    -- email | call | sms
  status TEXT NOT NULL DEFAULT 'pending_approval', -- pending_approval | approved | cancelled | done
  note TEXT,
  created_at TEXT NOT NULL,
  approved_at TEXT
);

CREATE TABLE IF NOT EXISTS calls (
  id TEXT PRIMARY KEY,
  lead_id TEXT REFERENCES leads(id) ON DELETE CASCADE,
  batch_id TEXT,
  phone TEXT NOT NULL,
  is_test INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | queued | in_progress | ended | failed | blocked | cancelled
  brief TEXT,
  first_message TEXT,
  vapi_call_id TEXT,
  outcome TEXT,                           -- booked | interested | not_interested | call_back | do_not_contact | no_answer | voicemail
  summary TEXT,
  transcript TEXT,
  recording_url TEXT,
  ended_reason TEXT,
  error TEXT,
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sms (
  id TEXT PRIMARY KEY,
  lead_id TEXT REFERENCES leads(id) ON DELETE CASCADE,
  batch_id TEXT,
  phone TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  provider_id TEXT,
  error TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL
);

-- One global do-not-contact list for every channel. value is normalised (lowercase email,
-- E.164 phone, or bare domain).
CREATE TABLE IF NOT EXISTS dnc (
  value TEXT PRIMARY KEY,
  kind TEXT NOT NULL,        -- email | phone | domain
  reason TEXT,
  source TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id TEXT,
  channel TEXT NOT NULL,     -- email | call | sms | whatsapp | form | social | system
  type TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_lead ON events(lead_id);
CREATE INDEX IF NOT EXISTS events_type ON events(type, created_at);

CREATE TABLE IF NOT EXISTS sequences (
  lead_id TEXT PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  step INTEGER NOT NULL DEFAULT 1,
  next_at TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- active | stopped | done
  stop_reason TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,     -- whatsapp | contact_form | linkedin | facebook | instagram
  message TEXT NOT NULL,
  url TEXT,
  status TEXT NOT NULL DEFAULT 'open', -- open | done | skipped
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  payload JSON NOT NULL,
  run_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', -- queued | running | done | failed
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_due ON jobs(status, run_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSON NOT NULL
);
`;

/**
 * SQLite comes from Node's built-in `node:sqlite` (Node 22.13+), so there is no native module to
 * compile on Windows. It is loaded with process.getBuiltinModule so bundlers never touch it.
 * This thin wrapper keeps the small better-sqlite3-style API the rest of the app uses.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
class Stmt {
  constructor(private s: StatementSync) {}
  get(...args: unknown[]): any {
    return this.s.get(...(args as never[]));
  }
  all(...args: unknown[]): any[] {
    return this.s.all(...(args as never[]));
  }
  run(...args: unknown[]): { changes: number; lastInsertRowid: number } {
    const r = this.s.run(...(args as never[]));
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }
}

export class Db {
  constructor(private conn: DatabaseSync) {}
  exec(sql: string) {
    this.conn.exec(sql);
  }
  prepare(sql: string) {
    return new Stmt(this.conn.prepare(sql));
  }
  /** Returns a function that runs `fn` inside one transaction. */
  transaction<T>(fn: () => T): () => T {
    return () => {
      this.conn.exec("BEGIN IMMEDIATE");
      try {
        const result = fn();
        this.conn.exec("COMMIT");
        return result;
      } catch (e) {
        this.conn.exec("ROLLBACK");
        throw e;
      }
    };
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __fiseDb: Db | undefined;
}

export function db(): Db {
  if (!globalThis.__fiseDb) {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const sqlite = process.getBuiltinModule?.("node:sqlite") as typeof import("node:sqlite") | undefined;
    if (!sqlite) throw new Error("This app needs Node.js 22.13 or newer (built-in SQLite). Your version: " + process.version);
    const conn = new sqlite.DatabaseSync(path.join(config.dataDir, "outreach.db"));
    conn.exec("PRAGMA journal_mode = WAL");
    conn.exec("PRAGMA busy_timeout = 5000");
    conn.exec("PRAGMA foreign_keys = ON");
    conn.exec(SCHEMA);
    globalThis.__fiseDb = new Db(conn);
  }
  return globalThis.__fiseDb;
}

export const now = () => new Date().toISOString();

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function logEvent(leadId: string | null, channel: string, type: string, detail?: string) {
  db()
    .prepare("INSERT INTO events (lead_id, channel, type, detail, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(leadId, channel, type, detail ?? null, now());
}

export function recordUsage(service: string, units: number, cost: number, note?: string) {
  db()
    .prepare("INSERT INTO api_usage (service, units, cost, note, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(service, units, cost, note ?? null, now());
}
