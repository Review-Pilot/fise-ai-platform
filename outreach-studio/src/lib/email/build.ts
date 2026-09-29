// Creates / updates an email draft: copy → graphic → HTML (React Email) → plain text → checks.
import { render } from "@react-email/render";
import { createElement } from "react";
import { db, newId, now, parseJson, logEvent } from "../db";
import { getLead, updateLead } from "../leads";
import { getSettings } from "../settings";
import { config, ownDomains } from "../config";
import { fallbackColors } from "../color";
import { unsubscribeUrls } from "../unsubscribe";
import { bestEmail } from "../site/contacts";
import { generateCopy } from "./copy";
import { renderChatGraphic, saveGraphic } from "./graphic";
import { OutreachEmail, type TemplateProps } from "./Template";
import { runChecks } from "./checks";
import type { EmailCheck, EmailCopy, Lead } from "../types";

export interface EmailRow {
  id: string;
  lead_id: string;
  kind: "initial" | "followup1" | "followup2";
  to_email: string | null;
  subject: string;
  preheader: string;
  copy: EmailCopy & { followupBody?: string };
  html: string;
  text: string;
  image_file: string | null;
  checks: EmailCheck[];
  status: string;
  batch_id: string | null;
  provider_id: string | null;
  error: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export function getEmail(id: string): EmailRow | null {
  const row = db().prepare("SELECT * FROM emails WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return { ...(row as unknown as EmailRow), copy: parseJson(row.copy, {} as EmailCopy), checks: parseJson(row.checks, []) };
}

export function latestDraft(leadId: string): EmailRow | null {
  const row = db()
    .prepare("SELECT id FROM emails WHERE lead_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(leadId) as { id: string } | undefined;
  return row ? getEmail(row.id) : null;
}

function ensureLandingSlug(lead: Lead): string {
  if (lead.landing_slug) return lead.landing_slug;
  const base = lead.business_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "demo";
  const slug = `${base}-${Math.random().toString(36).slice(2, 7)}`;
  updateLead(lead.id, { landing_slug: slug });
  return slug;
}

export function ctaUrlFor(lead: Lead): string {
  const s = getSettings();
  if (s.landingPages.enabled) return `${config.publicBaseUrl}/p/${ensureLandingSlug(lead)}`;
  return s.profile.demoUrl;
}

export function reasonLine(lead: Lead, toEmail: string): string {
  const s = getSettings();
  const found = lead.contacts.find((c) => c.kind === "email" && c.value === toEmail);
  const src = found?.sourceUrl ?? "";
  const source = src.startsWith("http")
    ? `listed publicly on ${new URL(src).hostname.replace(/^www\./, "")}`
    : src && src !== "manual entry"
      ? `listed publicly on ${src}`
      : "listed publicly";
  return `You're receiving this because ${toEmail} is ${source} as a contact for ${lead.business_name}. I'm ${s.profile.senderName} from ${s.profile.company}. If you'd prefer not to hear from us, unsubscribe below and we won't contact you again.`;
}

export function plainText(p: TemplateProps): string {
  const lines: string[] = [p.copy.greeting, ""];
  if (p.followupBody) lines.push(p.followupBody, "");
  else {
    lines.push(p.copy.opening, "");
    for (const b of p.copy.benefits) lines.push(`* ${b.title}: ${b.detail}`, `  Customers ask: "${b.exampleQuestion}"`, "");
    if (p.image) lines.push(`[${p.image.alt}]`, "");
    if (p.copy.comparison) lines.push(p.copy.comparison, "");
  }
  lines.push(`${p.copy.ctaText}: ${p.ctaUrl}`, "");
  if (!p.followupBody) lines.push(p.copy.closing, "");
  lines.push("Kind regards,", p.sender.name, `${p.sender.title}, ${p.sender.company}`, `${p.sender.phone} · ${p.websiteUrl}`, "", "--", p.reasonLine, `${p.sender.company}, ${p.sender.address}`, `Unsubscribe: ${p.unsubscribeUrl}`);
  return lines.join("\n");
}

export function imageAlt(copy: EmailCopy, businessName: string) {
  const convo = copy.chatMockup.map((m) => `${m.from === "visitor" ? "Customer" : "Assistant"}: ${m.text}`).join(" / ");
  return `Example ${businessName} website chat. ${convo}`.slice(0, 400);
}

/** Renders HTML/text/checks for a draft and saves it. */
export async function renderEmail(emailId: string, opts: { regenerateImage?: boolean } = {}): Promise<EmailRow> {
  const email = getEmail(emailId)!;
  const lead = getLead(email.lead_id)!;
  const s = getSettings();
  const colors = lead.colors ?? fallbackColors(s.profile.defaultColors);
  const to = email.to_email ?? bestEmail(lead.contacts)?.value ?? "recipient@example.com";
  const unsub = unsubscribeUrls(to, lead.id);

  let imageFile = email.image_file;
  let imageMeta: { width: number; height: number } | null = null;
  if (email.kind === "initial" && (opts.regenerateImage || !imageFile)) {
    const buf = await renderChatGraphic({
      businessName: lead.business_name,
      colors,
      messages: email.copy.chatMockup,
      logoUrl: lead.research?.logoUrl,
    });
    const saved = await saveGraphic(lead.id, buf);
    imageFile = saved.file;
    imageMeta = { width: saved.width, height: saved.height };
  }
  if (imageFile && !imageMeta) {
    const sharp = (await import("sharp")).default;
    const path = await import("node:path");
    const { imagesDir } = await import("./graphic");
    const meta = await sharp(path.join(imagesDir(), imageFile)).metadata().catch(() => null);
    imageMeta = meta ? { width: meta.width ?? 560, height: meta.height ?? 400 } : null;
  }

  const props: TemplateProps = {
    kind: email.kind,
    copy: email.copy,
    followupBody: email.copy.followupBody,
    colors,
    businessName: lead.business_name,
    image:
      email.kind === "initial" && imageFile && imageMeta
        ? { src: `${config.publicBaseUrl}/i/${imageFile}`, ...imageMeta, alt: imageAlt(email.copy, lead.business_name) }
        : null,
    ctaUrl: ctaUrlFor(lead),
    websiteUrl: s.profile.websiteUrl,
    unsubscribeUrl: unsub.page,
    reasonLine: reasonLine(lead, to),
    sender: {
      name: s.profile.senderName,
      title: s.profile.senderTitle,
      company: s.profile.company,
      phone: s.profile.phone,
      address: s.profile.address,
    },
  };
  const html = await render(createElement(OutreachEmail, props));
  const text = plainText(props);
  const checks = runChecks({
    html,
    text,
    copy: email.copy,
    subject: email.copy.subject,
    ownDomains: ownDomains(),
    unsubscribeUrl: unsub.page,
    address: s.profile.address,
    isFollowup: email.kind !== "initial",
  });
  if (!email.to_email || !to || to === "recipient@example.com") {
    checks.unshift({ id: "recipient", label: "Recipient email found and valid", ok: false, severity: "error", detail: "No usable email for this lead" });
  } else {
    const c = lead.contacts.find((x) => x.kind === "email" && x.value === to);
    checks.unshift({
      id: "recipient",
      label: "Recipient email found and valid",
      ok: c?.valid !== false,
      severity: "error",
      detail: c?.validationNote ?? to,
    });
  }
  db()
    .prepare("UPDATE emails SET html = ?, text = ?, checks = ?, image_file = ?, subject = ?, preheader = ?, to_email = ?, updated_at = ? WHERE id = ?")
    .run(html, text, JSON.stringify(checks), imageFile, email.copy.subject, email.copy.preheader, email.to_email ?? (to === "recipient@example.com" ? null : to), now(), emailId);
  return getEmail(emailId)!;
}

/** Generates a fresh initial email for a lead (new draft, or replaces the copy of an existing draft). */
export async function generateEmail(leadId: string, existingId?: string): Promise<{ email: EmailRow; issues: string[]; source: string }> {
  const lead = getLead(leadId);
  if (!lead) throw new Error("Lead not found");
  const { copy, issues, source } = await generateCopy(lead);
  const to = bestEmail(lead.contacts)?.value ?? null;
  let id = existingId;
  if (id && getEmail(id)?.status === "draft") {
    db().prepare("UPDATE emails SET copy = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(copy), now(), id);
  } else {
    id = newId("em");
    db()
      .prepare("INSERT INTO emails (id, lead_id, kind, to_email, subject, preheader, copy, status, created_at, updated_at) VALUES (?, ?, 'initial', ?, ?, ?, ?, 'draft', ?, ?)")
      .run(id, leadId, to, copy.subject, copy.preheader, JSON.stringify(copy), now(), now());
  }
  logEvent(leadId, "email", "draft_generated", `${source}${issues.length ? ` (${issues.length} rule warnings)` : ""}`);
  const email = await renderEmail(id!, { regenerateImage: true });
  return { email, issues, source };
}

/** Saves user edits to a draft and re-renders. */
export async function saveEdits(emailId: string, patch: Partial<EmailCopy> & { to_email?: string }, regenerateImage = false) {
  const email = getEmail(emailId);
  if (!email) throw new Error("Email not found");
  if (email.status !== "draft") throw new Error(`This email is ${email.status} and can no longer be edited`);
  const { to_email, ...copyPatch } = patch;
  const copy = { ...email.copy, ...copyPatch };
  db()
    .prepare("UPDATE emails SET copy = ?, to_email = COALESCE(?, to_email), updated_at = ? WHERE id = ?")
    .run(JSON.stringify(copy), to_email?.trim().toLowerCase() || null, now(), emailId);
  return renderEmail(emailId, { regenerateImage });
}
