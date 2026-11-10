// Extracts publicly listed contact details from crawled pages. Never guesses addresses.
import dns from "node:dns/promises";
import type { CheerioAPI } from "cheerio";
import type { BestRoute, ContactDetail } from "../types";
import { normalisePhone } from "../dnc";

const GENERIC_LOCAL = /^(info|hello|hi|contact|enquiries|enquiry|inquiries|inquiry|office|admin|reception|bookings?|sales|mail|team|studio|general|appointments?|quotes?)$/i;
const SUPPORT_LOCAL = /^(support|help|helpdesk|service|customerservice|care|no-?reply|donotreply|accounts?|billing|finance|hr|careers|jobs|webmaster|postmaster|abuse|privacy|legal|marketing|media|press)$/i;
const JUNK_EMAIL = /(\.(png|jpe?g|gif|svg|webp)$|@(example|domain|email|sentry|wixpress|sentry-next)\.|@2x|u00|^[0-9a-f]{20,}@)/i;

const SOCIAL: { kind: ContactDetail["kind"]; re: RegExp }[] = [
  { kind: "facebook", re: /^https?:\/\/(www\.|m\.)?facebook\.com\/(?!sharer|share|plugins|tr\b|dialog)[^\s"'?#]+/i },
  { kind: "instagram", re: /^https?:\/\/(www\.)?instagram\.com\/(?!p\/|explore)[^\s"'?#]+/i },
  { kind: "linkedin", re: /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/(company|in)\/[^\s"'?#]+/i },
  { kind: "twitter", re: /^https?:\/\/(www\.)?(twitter|x)\.com\/(?!intent|share)[^\s"'?#]+/i },
  { kind: "tiktok", re: /^https?:\/\/(www\.)?tiktok\.com\/@[^\s"'?#]+/i },
  { kind: "youtube", re: /^https?:\/\/(www\.)?youtube\.com\/(channel|c|user|@)[^\s"'?#]*/i },
];

export function classifyEmail(email: string, ownerFirstName?: string): ContactDetail["emailType"] {
  const local = email.split("@")[0].toLowerCase();
  if (SUPPORT_LOCAL.test(local)) return "support";
  if (GENERIC_LOCAL.test(local)) return "generic";
  if (ownerFirstName && local.includes(ownerFirstName.toLowerCase())) return "named";
  // "first.last" style addresses are almost always a person. Single words ("workshop@",
  // "thabo@") are only treated as named once matched to an owner name found on the site.
  if (/^[a-z]{2,}[._-][a-z]{1,}$/.test(local)) return "named";
  return "generic";
}

/** Decode Cloudflare's email obfuscation (data-cfemail). */
function decodeCfEmail(hex: string): string {
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

export function extractContacts($: CheerioAPI, pageUrl: string, text: string): ContactDetail[] {
  const at = new Date().toISOString();
  const out: ContactDetail[] = [];
  const add = (c: Omit<ContactDetail, "sourceUrl" | "foundAt">) =>
    out.push({ ...c, sourceUrl: pageUrl, foundAt: at });

  const emails = new Set<string>();
  $("a[href^='mailto:' i]").each((_, el) => {
    const v = decodeURIComponent(($(el).attr("href") ?? "").slice(7).split("?")[0]).trim().toLowerCase();
    if (v) emails.add(v);
  });
  $("[data-cfemail]").each((_, el) => {
    try {
      emails.add(decodeCfEmail($(el).attr("data-cfemail") ?? "").toLowerCase());
    } catch {
      /* ignore */
    }
  });
  const deobfuscated = text.replace(/\s*[\[(]\s*at\s*[\])]\s*/gi, "@").replace(/\s*[\[(]\s*dot\s*[\])]\s*/gi, ".");
  for (const m of deobfuscated.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) emails.add(m[0].toLowerCase());
  for (const e of emails) {
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e) || JUNK_EMAIL.test(e)) continue;
    add({ kind: "email", value: e, emailType: classifyEmail(e) });
  }

  const phones = new Set<string>();
  $("a[href^='tel:' i]").each((_, el) => {
    const p = normalisePhone(($(el).attr("href") ?? "").slice(4));
    if (p) phones.add(p);
  });
  for (const m of text.matchAll(/(?:\+27|\b0)[\s-]?\(?\d{2}\)?[\s-]?\d{3}[\s-]?\d{4}\b/g)) {
    const p = normalisePhone(m[0]);
    if (p) phones.add(p);
  }
  for (const p of phones) add({ kind: "phone", value: p });

  const was = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const wa = href.match(/wa\.me\/(\+?\d{9,15})|api\.whatsapp\.com\/send\/?\?phone=(\+?\d{9,15})/i);
    if (wa) {
      const p = normalisePhone(wa[1] ?? wa[2]);
      if (p) was.add(p);
    }
    for (const s of SOCIAL) {
      const m = href.match(s.re);
      if (m && !out.some((c) => c.kind === s.kind)) add({ kind: s.kind, value: m[0].replace(/\/+$/, "") });
    }
  });
  for (const p of was) add({ kind: "whatsapp", value: p });

  const hasForm = $("form").toArray().some((f) => $(f).find("textarea").length > 0 || /wpcf7|gform|wpforms|elementor-form/i.test($(f).attr("class") ?? ""));
  if (hasForm) add({ kind: "contact_form", value: pageUrl });

  return out;
}

export function mergeContacts(all: ContactDetail[]): ContactDetail[] {
  const map = new Map<string, ContactDetail>();
  for (const c of all) {
    const key = `${c.kind}:${c.value}`;
    if (!map.has(key)) map.set(key, c);
  }
  return [...map.values()];
}

/** Syntax + MX record check. No SMTP probing, no guessing. */
export async function validateEmail(email: string): Promise<{ valid: boolean; note: string }> {
  if (!/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(email)) return { valid: false, note: "Invalid syntax" };
  const domain = email.split("@")[1];
  try {
    const mx = await dns.resolveMx(domain);
    if (!mx.length) return { valid: false, note: "No MX records" };
    if (mx.length === 1 && mx[0].exchange === "") return { valid: false, note: "Null MX — domain accepts no mail" };
    return { valid: true, note: `MX: ${mx.sort((a, b) => a.priority - b.priority)[0].exchange}` };
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "ENOTFOUND" || code === "ENODATA") return { valid: false, note: "Domain has no mail server" };
    return { valid: false, note: `MX lookup failed (${code ?? "error"})` };
  }
}

/** Attach the owner name to a matching email, rank, and pick the best route. */
export function rankContacts(contacts: ContactDetail[], owner?: { name?: string; role?: string }): {
  contacts: ContactDetail[];
  bestRoute: BestRoute;
} {
  const first = owner?.name?.split(/\s+/)[0]?.toLowerCase();
  for (const c of contacts) {
    if (c.kind !== "email") continue;
    const local = c.value.split("@")[0].toLowerCase();
    if (first && first.length > 1 && local.includes(first)) {
      c.emailType = "named";
      c.personName = owner?.name;
      c.personRole = owner?.role;
    }
  }
  const order = { named: 0, generic: 1, support: 2 } as const;
  contacts.sort((a, b) => {
    if (a.kind === "email" && b.kind === "email") {
      const v = Number(b.valid !== false) - Number(a.valid !== false);
      return v || order[a.emailType ?? "generic"] - order[b.emailType ?? "generic"];
    }
    return 0;
  });
  const usableEmail = contacts.find((c) => c.kind === "email" && c.valid !== false && c.emailType !== "support");
  let bestRoute: BestRoute = "none";
  if (usableEmail?.emailType === "named") bestRoute = "owner_email";
  else if (usableEmail) bestRoute = "generic_email";
  else if (contacts.some((c) => c.kind === "phone")) bestRoute = "phone";
  else if (contacts.some((c) => c.kind === "whatsapp")) bestRoute = "whatsapp";
  else if (contacts.some((c) => c.kind === "contact_form")) bestRoute = "contact_form";
  return { contacts, bestRoute };
}

export function bestEmail(contacts: ContactDetail[]): ContactDetail | undefined {
  return contacts.find((c) => c.kind === "email" && c.valid !== false && c.emailType !== "support");
}
