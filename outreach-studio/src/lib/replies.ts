// Reply tracking over IMAP (works with Gmail app passwords, Google Workspace, Microsoft 365, cPanel mail).
// No tracking pixels or redirect links: replies are what we count.
import { ImapFlow } from "imapflow";
import { config } from "./config";
import { db, now, logEvent } from "./db";
import { getLead, setStatus, updateLead } from "./leads";
import { stopSequence } from "./sequences";
import { optOut } from "./optout";
import { claudeEnabled, classifyReply } from "./claude";

const STATE_KEY = "imap_state";

function getState(): { lastUid: number; uidValidity: string | null } {
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(STATE_KEY) as { value: string } | undefined;
  return row ? JSON.parse(row.value) : { lastUid: 0, uidValidity: null };
}
function setState(s: { lastUid: number; uidValidity: string | null }) {
  db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(STATE_KEY, JSON.stringify(s));
}

/** Finds the lead a sender belongs to (exact email we wrote to, or the lead's domain). */
export function matchLead(fromEmail: string): string | null {
  const e = fromEmail.toLowerCase();
  const byEmail = db().prepare("SELECT lead_id FROM emails WHERE lower(to_email) = ? AND status = 'sent' ORDER BY sent_at DESC LIMIT 1").get(e) as { lead_id: string } | undefined;
  if (byEmail) return byEmail.lead_id;
  const domain = e.split("@")[1];
  const byDomain = db()
    .prepare("SELECT l.id FROM leads l JOIN emails m ON m.lead_id = l.id WHERE l.domain = ? AND m.status = 'sent' LIMIT 1")
    .get(domain) as { id: string } | undefined;
  return byDomain?.id ?? null;
}

const AUTO_REPLY = /(out of (the )?office|automatic reply|auto-?reply|autoreply|away from (the )?office|on leave|delivery status notification|undeliverable|mail delivery (failed|subsystem))/i;
const OPT_OUT = /\b(unsubscribe|remove me|stop (emailing|contacting)|do not (email|contact)|don'?t (email|contact)|take me off|opt[ -]?out)\b/i;

export async function handleReply(msg: { from: string; subject: string; text: string; date?: Date }) {
  const leadId = matchLead(msg.from);
  if (!leadId) return null;
  if (AUTO_REPLY.test(msg.subject)) {
    logEvent(leadId, "email", "auto_reply", msg.subject);
    return "auto_reply";
  }
  let intent: string = OPT_OUT.test(`${msg.subject}\n${msg.text.slice(0, 2000)}`) ? "unsubscribe" : "other";
  let summary = msg.subject;
  if (claudeEnabled()) {
    try {
      const r = await classifyReply(`Subject: ${msg.subject}\n\n${msg.text}`);
      // A keyword opt-out always wins, even if the classifier disagrees.
      intent = intent === "unsubscribe" ? intent : r.intent;
      summary = r.summary;
    } catch {
      /* keep keyword result */
    }
  }
  if (intent === "out_of_office") {
    logEvent(leadId, "email", "auto_reply", summary);
    return intent;
  }
  updateLead(leadId, { replied_at: (msg.date ?? new Date()).toISOString() });
  stopSequence(leadId, "replied");
  logEvent(leadId, "email", "reply", `${intent}: ${summary}`);
  if (intent === "unsubscribe" || intent === "not_interested") {
    optOut({ leadId, email: msg.from, channel: "email", reason: intent === "unsubscribe" ? "Asked to unsubscribe by reply" : "Replied not interested" });
    if (intent === "not_interested") setStatus(leadId, "Do not contact", "reply");
  } else {
    setStatus(leadId, "Replied", "reply received");
    if (intent === "interested") updateLead(leadId, { consent_status: "granted" });
  }
  return intent;
}

export async function pollReplies(): Promise<number> {
  const { host, port, user, pass } = config.imap;
  if (!host || !user) return 0;
  const client = new ImapFlow({ host, port, secure: port === 993, auth: { user, pass }, logger: false });
  let handled = 0;
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    const mailbox = client.mailbox as { uidValidity?: bigint; uidNext?: number };
    const state = getState();
    const validity = String(mailbox.uidValidity ?? "");
    // First run: start from now (don't process the whole historic inbox).
    if (state.uidValidity !== validity) {
      setState({ lastUid: Math.max(0, (mailbox.uidNext ?? 1) - 1), uidValidity: validity });
      return 0;
    }
    let maxUid = state.lastUid;
    for await (const m of client.fetch({ uid: `${state.lastUid + 1}:*` }, { envelope: true, source: { maxLength: 20000 } as never, uid: true }, { uid: true })) {
      if (m.uid <= state.lastUid) continue;
      maxUid = Math.max(maxUid, m.uid);
      const from = m.envelope?.from?.[0]?.address;
      if (!from) continue;
      const raw = m.source?.toString("utf8") ?? "";
      const text = raw.split(/\r?\n\r?\n/).slice(1).join("\n\n").replace(/<[^>]+>/g, " ").slice(0, 8000);
      if (await handleReply({ from, subject: m.envelope?.subject ?? "", text, date: m.envelope?.date ? new Date(m.envelope.date) : undefined })) handled++;
    }
    setState({ lastUid: maxUid, uidValidity: validity });
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
  db().prepare("INSERT INTO settings (key, value) VALUES ('imap_last_poll', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(now()));
  return handled;
}
