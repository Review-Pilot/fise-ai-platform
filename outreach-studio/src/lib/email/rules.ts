// Copy rules shared by generation and the pre-send checker.
import type { EmailCopy } from "../types";

export const SPAM_PHRASES = [
  "free money", "act now", "guaranteed", "guarantee", "100%", "risk-free", "risk free", "limited time", "urgent",
  "winner", "cash bonus", "click here", "buy now", "no obligation", "special promotion", "once in a lifetime",
  "amazing", "revolutionary", "earn money", "make money", "double your", "no cost", "lowest price", "best price",
  "call now", "order now", "15-minute", "15 minute", "apply now", "exclusive deal", "congratulations", "dear friend", "miracle", "$$$",
  "increase sales", "incredible deal", "unbelievable", "!!!",
];

/** Short all-caps words that are fine (acronyms). */
const ACRONYMS = new Set(["AI", "SA", "FAQ", "FAQS", "COC", "COCS", "DB", "VAT", "SMS", "CEO", "SEO", "HVAC", "CCTV", "LED", "PC", "IT", "HR", "UK", "USA", "USD", "ZAR", "OK", "TV", "GP", "ID", "PDF", "SAST", "DSTV", "CBD", "B&B", "N1", "N2", "M3", "IVF", "MRI", "ECG", "BMW", "VW", "NHBRC", "SANS", "POPIA", "PPE", "DIY", "RSVP", "Q&A"]);

export function wordCount(s: string): number {
  return s.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length;
}

export function copyBodyText(c: Pick<EmailCopy, "opening" | "benefits" | "comparison" | "closing">): string {
  return [
    c.opening,
    ...c.benefits.map((b) => `${b.title}. ${b.detail} "${b.exampleQuestion}"`),
    c.comparison,
    c.closing,
  ].join(" ");
}

export function capsWords(s: string): string[] {
  return (s.match(/\b[A-Z][A-Z&]{2,}\b/g) ?? []).filter((w) => !ACRONYMS.has(w));
}

export function spamHits(s: string): string[] {
  const lower = s.toLowerCase();
  return SPAM_PHRASES.filter((p) => lower.includes(p));
}

/** Returns human-readable rule violations (empty = good). */
export function validateCopy(c: EmailCopy): string[] {
  const issues: string[] = [];
  const body = copyBodyText(c);
  const wc = wordCount(body);
  if (wc < 120 || wc > 200) issues.push(`Body is ${wc} words; it must be 120–200.`);
  if (c.subject.length >= 50) issues.push(`Subject is ${c.subject.length} characters; keep it under 50.`);
  if (/[!?]{2,}|!|\$|%|[\u{1F300}-\u{1FAFF}]/u.test(c.subject)) issues.push("Subject contains spammy punctuation or emoji.");
  if (c.subject === c.subject.toUpperCase() && /[A-Z]/.test(c.subject)) issues.push("Subject is in all caps.");
  if (c.benefits.length < 2 || c.benefits.length > 3) issues.push("Use 2 or 3 benefits.");
  const everything = [c.subject, c.preheader, body, c.ctaText].join(" ");
  const caps = capsWords(everything);
  if (caps.length) issues.push(`Avoid ALL CAPS words: ${[...new Set(caps)].join(", ")}.`);
  if (/!!/.test(everything)) issues.push('Remove repeated exclamation marks ("!!").');
  const spam = spamHits(everything);
  if (spam.length) issues.push(`Remove spam-trigger words: ${spam.join(", ")}.`);
  if (wordCount(c.ctaText) > 6) issues.push("Button text should be 2–5 words.");
  return issues;
}
