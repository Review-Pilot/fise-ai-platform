// Pre-send deliverability checks on the final HTML + text. Errors block sending.
import * as cheerio from "cheerio";
import net from "node:net";
import type { EmailCheck, EmailCopy } from "../types";
import { validateCopy, spamHits, capsWords } from "./rules";

const SHORTENERS = /(^|\.)(bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|buff\.ly|rebrand\.ly|is\.gd|cutt\.ly|shorturl\.at|tiny\.cc|lnkd\.in|rb\.gy|t\.ly|bl\.ink)$/i;

export function runChecks(opts: {
  html: string;
  text: string;
  copy: EmailCopy;
  subject: string;
  ownDomains: string[];
  unsubscribeUrl: string;
  address: string;
  isFollowup?: boolean;
}): EmailCheck[] {
  const { html, text } = opts;
  const checks: EmailCheck[] = [];
  const add = (id: string, label: string, ok: boolean, detail?: string, severity: EmailCheck["severity"] = "error") =>
    checks.push({ id, label, ok, detail, severity });

  const bytes = Buffer.byteLength(html, "utf8");
  add("size", "HTML under 100 KB", bytes < 100_000, `${(bytes / 1024).toFixed(1)} KB`);

  // Strip Outlook conditional comments before parsing so VML isn't double-counted.
  const visibleHtml = html.replace(/<!--\[if mso\]>[\s\S]*?<!\[endif\]-->/g, "");
  const $ = cheerio.load(visibleHtml);

  add("tables", "Table-based layout", $("table").length > 0);
  const forbidden = ["script", "form", "iframe", "video", "audio", "embed", "object", "input", "button"].filter((t) => $(t).length > 0);
  add("forbidden", "No scripts, forms, iframes or video", forbidden.length === 0, forbidden.join(", ") || undefined);
  add("fonts", "No embedded web fonts", !/@font-face|fonts\.googleapis|<link[^>]+stylesheet/i.test(html));
  add("style", "No <style>-only styling (all CSS inline)", $("style").length === 0, undefined, "warning");

  const links = $("a[href]").toArray().map((a) => ({ href: $(a).attr("href")!, text: $(a).text().trim() }));
  add("links_count", "At most 3 links", links.length <= 3, `${links.length} links`);
  const badLinks: string[] = [];
  for (const l of links) {
    let u: URL;
    try {
      u = new URL(l.href);
    } catch {
      badLinks.push(`${l.href} (invalid URL)`);
      continue;
    }
    const host = u.hostname.toLowerCase();
    if (u.protocol !== "https:") badLinks.push(`${l.href} (not https)`);
    if (net.isIP(host)) badLinks.push(`${l.href} (raw IP address)`);
    if (SHORTENERS.test(host)) badLinks.push(`${l.href} (URL shortener)`);
    if (!opts.ownDomains.some((d) => host === d || host.endsWith(`.${d}`))) badLinks.push(`${host} (not one of your domains: ${opts.ownDomains.join(", ") || "none set"})`);
    // Link text that looks like a URL/domain must match the destination.
    const shown = l.text.match(/([a-z0-9-]+\.)+[a-z]{2,}/i)?.[0]?.toLowerCase().replace(/^www\./, "");
    if (shown && !host.replace(/^www\./, "").endsWith(shown) && !shown.endsWith(host.replace(/^www\./, ""))) {
      badLinks.push(`"${l.text}" points to ${host} (text doesn't match destination)`);
    }
  }
  add("links_domains", "Links: https, own domain, no shorteners/IPs, text matches destination", badLinks.length === 0, badLinks.join("; ") || undefined);

  const imgs = $("img").toArray();
  add("images_count", "At most 2 images", imgs.length <= 2, `${imgs.length} image(s)`);
  const imgIssues = imgs
    .filter((i) => !$(i).attr("alt") || !$(i).attr("width") || !$(i).attr("height"))
    .map((i) => $(i).attr("src") ?? "?");
  add("images_attrs", "Every image has alt text, width and height", imgIssues.length === 0, imgIssues.join(", ") || undefined);
  const visibleText = $("body").text().replace(/\s+/g, " ").trim();
  const words = visibleText.split(" ").length;
  add("ratio", "Mostly text (reads fine with images off)", imgs.length === 0 || words / imgs.length >= 120, `${words} words, ${imgs.length} image(s)`);

  add("unsubscribe_html", "Working unsubscribe link in the footer", html.includes(opts.unsubscribeUrl));
  add("unsubscribe_text", "Plain-text version includes unsubscribe link", text.includes(opts.unsubscribeUrl));
  add("address", "Physical business address in footer", visibleText.includes(opts.address.split(",")[0].trim()));
  add("plaintext", "Plain-text version generated", text.trim().length > 200);
  add("no_attachments", "No attachments", true);

  add("subject_len", "Subject under 50 characters", opts.subject.length < 50, `${opts.subject.length} characters`);
  add("subject_punct", "No spammy punctuation in subject", !/!|\?{2,}|\$|%|[\u{1F300}-\u{1FAFF}]/u.test(opts.subject));
  add("preheader", "Preheader text present", opts.copy.preheader.trim().length >= 20);
  const spam = spamHits(`${opts.subject} ${visibleText}`);
  add("spam_words", "No spam-trigger words", spam.length === 0, spam.join(", ") || undefined);
  const caps = capsWords(`${opts.subject} ${visibleText}`);
  add("caps", "No ALL CAPS words", caps.length === 0, [...new Set(caps)].join(", ") || undefined);
  add("exclaim", 'No "!!"', !/!!/.test(visibleText));

  if (!opts.isFollowup) {
    const copyIssues = validateCopy(opts.copy).filter((i) => /words/.test(i));
    add("word_count", "Body copy 120–200 words", copyIssues.length === 0, copyIssues.join(" "));
  }
  return checks;
}

export function hasBlockingErrors(checks: EmailCheck[]): boolean {
  return checks.some((c) => !c.ok && c.severity === "error");
}
