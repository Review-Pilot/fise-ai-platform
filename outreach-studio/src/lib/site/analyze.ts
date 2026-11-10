// Researches one lead: crawls a handful of pages, extracts everything, scores it.
import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import { politeFetch, RobotsBlockedError } from "../http";
import { detectParked, detectPlatform, isSocialOnlyUrl } from "./platform";
import { detectChatTools, hasRealChat } from "./widgets";
import { extractContacts, mergeContacts, rankContacts, validateEmail } from "./contacts";
import { candidatesFromCss, candidatesFromHtml, candidatesFromLogo } from "./colors";
import { pickPalette, fallbackColors, type ColorCandidate, toHex } from "../color";
import { claudeEnabled, summariseSite, writeComparison, type ResearchSummary } from "../claude";
import { getLead, updateLead, setStatus } from "../leads";
import { getPlace } from "../places";
import { getSettings } from "../settings";
import { qualify } from "../qualify";
import { logEvent } from "../db";
import type { ChatTool, ContactDetail, SiteResearch } from "../types";

const PAGE_HINT = /(contact|about|team|staff|meet|our-?story|who-?we-?are|people)/i;
const GUESSES = ["/contact", "/contact-us", "/about", "/about-us", "/team"];
const MAX_PAGES = 6;
const SKIP_CSS = /(bootstrap|font-?awesome|fontawesome|wp-includes|block-library|jquery|animate|slick|swiper|owl\.carousel|elementor\/assets\/lib|googleapis|gstatic|cdnjs|typekit)/i;

function visibleText($: CheerioAPI): string {
  const c = $.root().clone();
  c.find("script, style, noscript, svg, template, iframe").remove();
  return c.text().replace(/\s+/g, " ").trim();
}

function absolute(href: string | undefined, base: string): string | undefined {
  if (!href) return undefined;
  try {
    return new URL(href, base).toString();
  } catch {
    return undefined;
  }
}

function findLogo($: CheerioAPI, base: string): string | undefined {
  // 1. schema.org logo in JSON-LD
  for (const el of $("script[type='application/ld+json']").toArray()) {
    const m = $(el).text().match(/"logo"\s*:\s*(?:\{[^}]*"url"\s*:\s*)?"([^"]+)"/);
    if (m) return absolute(m[1], base);
  }
  // 2. <img> that looks like a logo, preferring ones in the header
  const imgs = $("header img, .header img, #header img, nav img, img").toArray();
  for (const img of imgs) {
    const $img = $(img);
    const blob = `${$img.attr("class") ?? ""} ${$img.attr("id") ?? ""} ${$img.attr("alt") ?? ""} ${$img.attr("src") ?? ""} ${$img.parent().attr("class") ?? ""}`;
    if (/logo/i.test(blob)) {
      const src = $img.attr("src") || $img.attr("data-src") || $img.attr("data-lazy-src");
      if (src && !src.startsWith("data:")) return absolute(src, base);
    }
  }
  // 3. Custom-logo from WordPress themes
  const wp = $(".custom-logo").attr("src");
  if (wp) return absolute(wp, base);
  return undefined;
}

function findFavicon($: CheerioAPI, base: string): string | undefined {
  const href =
    $("link[rel='apple-touch-icon']").attr("href") ||
    $("link[rel='icon'][sizes]").last().attr("href") ||
    $("link[rel~='icon']").attr("href");
  return absolute(href ?? "/favicon.ico", base);
}

/** Heuristic fallback when Claude isn't configured. */
function heuristicSummary(name: string, texts: string[], keyword?: string | null): ResearchSummary {
  const all = texts.join(" ");
  const NAME = "([A-Z][a-z]+(?:\\s[A-Z][a-z]+)?)";
  const ROLE = "(?:[Oo]wner|[Ff]ounder|[Pp]roprietor|[Mm]anaging [Dd]irector|[Dd]irector|[Pp]rincipal)";
  const owner =
    all.match(new RegExp(`(?:founded|started|run|owned) by ${NAME}`)) ??
    all.match(new RegExp(`${NAME},? (?:the |our )?${ROLE}`)) ??
    all.match(new RegExp(`${ROLE}[\\s:,–-]+${NAME}`));
  const team = all.match(/team of (\d{1,4})|(\d{1,4})\+?\s+(?:employees|staff members|staff|people)/i);
  const corporate = ["investor relations", "head office", "group of companies", "call centre", "national footprint", "branches nationwide", "subsidiary"]
    .filter((s) => all.toLowerCase().includes(s));
  const chain = ["franchise", "our branches", "find a branch", "store locator", "all locations", "nationwide"].filter((s) =>
    all.toLowerCase().includes(s),
  );
  return {
    industry: keyword ?? "",
    services: [],
    location: "",
    tone: "professional",
    ownerName: owner?.[1] ?? null,
    ownerRole: owner ? "Owner" : null,
    ownerEvidence: owner?.[0] ?? null,
    teamSizeEstimate: team ? Number(team[1] ?? team[2]) : null,
    ownerRunLikely: /family[- ]owned|owner[- ]run|founded by|i started|my name is/i.test(all),
    corporateSignals: corporate,
    chainSignals: chain,
    likelyCustomerQuestions: [
      `Do you service my area?`,
      `How much does a typical job cost?`,
      `Can I book for this week?`,
      `What are your hours?`,
      `Can someone call me back?`,
    ],
    afterHoursAngle: `Many ${keyword ?? "customers"} enquiries come in the evening after work, when ${name} is closed.`,
  };
}

export async function researchLead(leadId: string) {
  const lead = getLead(leadId);
  if (!lead) return;
  const settings = getSettings();
  const defaults = settings.profile.defaultColors;
  updateLead(leadId, { research_status: "running", research_error: null });
  const place = lead.place_id ? await getPlace(lead.place_id) : null;
  const isManual = lead.source !== "places";

  const fail = (why: string) => {
    updateLead(leadId, {
      research_status: "failed",
      research_error: why,
      qualified: isManual ? 1 : 0,
      disqualify_reason: isManual ? null : why,
      fit_score: isManual ? lead.fit_score : 0,
      fit_reason: why,
      colors: lead.colors?.source === "manual" ? lead.colors : fallbackColors(defaults),
    });
    logEvent(leadId, "system", "research_failed", why);
  };

  if (!lead.website) return fail("No website listed");
  if (isSocialOnlyUrl(lead.website)) return fail("Only a social media page, not a website");

  // ---- Homepage
  let home;
  try {
    home = await politeFetch(lead.website);
  } catch (e) {
    return fail(
      e instanceof RobotsBlockedError
        ? "robots.txt blocks our crawler — use manual colours"
        : `Website failed to load: ${e instanceof Error ? e.message : e}`,
    );
  }
  if (!home.ok) return fail(`Website returned HTTP ${home.status}`);
  if (isSocialOnlyUrl(home.finalUrl)) return fail("Website redirects to a social media page");

  const $ = cheerio.load(home.body);
  const homeText = visibleText($);
  const wordCount = homeText.split(/\s+/).filter(Boolean).length;
  const parked = detectParked(home.body, homeText, wordCount);
  const platform = detectPlatform(home.body, home.finalUrl, home.headers);
  const base = home.finalUrl;
  const baseHost = new URL(base).hostname;

  // ---- Discover contact/about/team pages
  const links = new Set<string>();
  $("a[href]").each((_, a) => {
    const href = absolute($(a).attr("href"), base);
    if (!href) return;
    const u = new URL(href);
    if (u.hostname !== baseHost || !/^https?:$/.test(u.protocol)) return;
    if (PAGE_HINT.test(u.pathname) || PAGE_HINT.test($(a).text())) {
      u.hash = "";
      u.search = "";
      links.add(u.toString());
    }
  });
  if (links.size < 2) for (const g of GUESSES) links.add(new URL(g, base).toString());

  const pages: SiteResearch["pages"] = [{ url: base, status: home.status, title: $("title").first().text().trim() }];
  const blocked: string[] = [];
  const texts: { url: string; text: string }[] = [{ url: base, text: homeText }];
  let contacts: ContactDetail[] = extractContacts($, base, homeText);
  let tools: ChatTool[] = detectChatTools(home.body);
  const colorCands: ColorCandidate[] = [...candidatesFromHtml($)];
  $("style").each((_, s) => {
    colorCands.push(...candidatesFromCss($(s).text(), "inline <style>"));
  });

  for (const url of [...links].slice(0, MAX_PAGES - 1)) {
    if (url.replace(/\/$/, "") === base.replace(/\/$/, "")) continue;
    try {
      const res = await politeFetch(url, 12000);
      pages.push({ url, status: res.status });
      if (!res.ok || !/html/i.test(res.contentType)) continue;
      const $p = cheerio.load(res.body);
      const t = visibleText($p);
      texts.push({ url: res.finalUrl, text: t });
      contacts.push(...extractContacts($p, res.finalUrl, t));
      for (const tool of detectChatTools(res.body)) if (!tools.some((x) => x.id === tool.id)) tools.push(tool);
    } catch (e) {
      if (e instanceof RobotsBlockedError) blocked.push(url);
    }
  }

  // Footer contacts are already covered by the homepage/contact pages.
  contacts = mergeContacts(contacts);
  tools = tools.filter((t, i) => tools.findIndex((x) => x.id === t.id) === i);

  // ---- Stylesheets (max 4, skipping frameworks) → colour candidates. Plain stylesheet counts are
  // capped per colour so a framework default can't outvote the brand colours.
  const sheets = $("link[rel='stylesheet']")
    .toArray()
    .map((l) => absolute($(l).attr("href"), base))
    .filter((h): h is string => Boolean(h) && !SKIP_CSS.test(h!))
    .slice(0, 4);
  const sheetCands: ColorCandidate[] = [];
  for (const href of sheets) {
    try {
      const res = await politeFetch(href, 10000);
      if (res.ok) sheetCands.push(...candidatesFromCss(res.body.slice(0, 800_000), "stylesheet"));
    } catch {
      /* optional */
    }
  }
  const capped = new Map<string, ColorCandidate>();
  for (const c of sheetCands) {
    const key = `${toHex(c.color)}|${c.source === "stylesheet" ? "s" : c.source}`;
    const cur = capped.get(key);
    if (cur) cur.weight = Math.min(c.source === "stylesheet" ? 6 : 12, cur.weight + c.weight);
    else capped.set(key, { ...c });
  }
  colorCands.push(...capped.values());

  const logoUrl = findLogo($, base);
  if (logoUrl) colorCands.push(...(await candidatesFromLogo(logoUrl)));
  const colors = lead.colors?.source === "manual" ? lead.colors : pickPalette(colorCands, defaults);

  // ---- Summary (Claude, with heuristic fallback)
  let summary: ResearchSummary;
  try {
    summary = claudeEnabled()
      ? await summariseSite({ businessName: lead.business_name, url: base, pages: texts, hours: place?.hours })
      : heuristicSummary(lead.business_name, texts.map((t) => t.text), lead.keyword);
  } catch (e) {
    logEvent(leadId, "system", "claude_error", String(e));
    summary = heuristicSummary(lead.business_name, texts.map((t) => t.text), lead.keyword);
  }

  // ---- Validate emails (syntax + MX, once per domain)
  const mxCache = new Map<string, { valid: boolean; note: string }>();
  for (const c of contacts.filter((c) => c.kind === "email")) {
    const d = c.value.split("@")[1];
    if (!mxCache.has(d)) mxCache.set(d, await validateEmail(c.value));
    const r = mxCache.get(d)!;
    c.valid = r.valid;
    c.validationNote = r.note;
  }
  // Keep a manually entered email (from the Outreach form) at the top.
  const manual = lead.contacts.filter((c) => c.sourceUrl === "manual entry");
  for (const m of manual) {
    if (!m.validationNote) {
      const r = await validateEmail(m.value);
      m.valid = r.valid;
      m.validationNote = r.note;
    }
  }
  const ranked = rankContacts(mergeContacts([...manual, ...contacts]), {
    name: summary.ownerName ?? undefined,
    role: summary.ownerRole ?? undefined,
  });

  const research: SiteResearch = {
    finalUrl: base,
    httpStatus: home.status,
    fetchedAt: new Date().toISOString(),
    pages,
    blockedByRobots: blocked,
    parked: parked.parked,
    parkedReason: parked.reason,
    socialOnly: false,
    platform: platform.platform,
    platformEvidence: platform.evidence,
    canInstall: platform.canInstall,
    canInstallReason: platform.canInstallReason,
    chatTools: tools,
    logoUrl,
    faviconUrl: findFavicon($, base),
    title: $("title").first().text().trim(),
    description: $("meta[name='description']").attr("content")?.trim(),
    industry: summary.industry || lead.keyword || undefined,
    services: summary.services,
    location: summary.location || lead.city || place?.address || undefined,
    tone: summary.tone,
    ownerName: summary.ownerName ?? undefined,
    ownerRole: summary.ownerRole ?? undefined,
    ownerEvidence: summary.ownerEvidence ?? undefined,
    teamSizeEstimate: summary.teamSizeEstimate,
    ownerRunLikely: summary.ownerRunLikely,
    corporateSignals: summary.corporateSignals,
    chainSignals: summary.chainSignals,
    likelyCustomerQuestions: summary.likelyCustomerQuestions,
    afterHoursAngle: summary.afterHoursAngle,
    wordCount,
  };

  const result = qualify(
    { businessName: lead.business_name, research, place, contacts: ranked.contacts, locations: lead.locations, isManual },
    settings.qualification,
  );

  updateLead(leadId, {
    research_status: "done",
    research_error: null,
    research,
    contacts: ranked.contacts,
    best_route: ranked.bestRoute,
    colors,
    industry: research.industry ?? null,
    platform: research.platform,
    can_install: research.canInstall,
    has_chatbot: hasRealChat(tools) ? 1 : 0,
    qualified: result.qualified ? 1 : 0,
    disqualify_reason: result.disqualifyReason,
    fit_score: result.score,
    fit_reason: result.reason,
    contact_first_name: lead.contact_first_name ?? research.ownerName?.split(" ")[0] ?? null,
  });
  if (result.qualified && lead.status === "New") setStatus(leadId, "Qualified", "auto");
  logEvent(leadId, "system", "researched", `${result.score}/100 — ${result.reason}`);

  // Static comparison (refined later if an approved chat test runs).
  await refreshComparison(leadId).catch((e) => logEvent(leadId, "system", "comparison_error", String(e)));
}

/** Writes the "why Fise" note from verified observations only. */
export async function refreshComparison(leadId: string) {
  const lead = getLead(leadId);
  if (!lead?.research) return;
  const r = lead.research;
  const observations: string[] = [];
  for (const t of r.chatTools) {
    if (t.category === "contact_form") observations.push("Their website has a contact form (enquiries wait until someone reads them).");
    else if (t.category === "whatsapp") observations.push("Their website has a WhatsApp button (a person has to reply).");
    else observations.push(`${t.name} (${t.category.replace("_", " ")}) is installed on their website.`);
  }
  if (!r.chatTools.length) observations.push("No chat widget or contact form was detected on the pages we checked.");
  const ct = lead.chat_test;
  if (ct && !ct.error) {
    observations.push(`We sent one test question ("${ct.question}") at ${ct.localTime} SAST${ct.afterHours ? " (after hours)" : ""}.`);
    observations.push(...ct.observations);
  }
  if (!claudeEnabled()) {
    const hasChat = hasRealChat(r.chatTools);
    updateLead(leadId, {
      comparison: hasChat
        ? `You already offer chat on your site. Fise adds instant, accurate answers from your own website content at any hour, and captures the customer's details when your team is offline.`
        : `Right now, visitors who have a question after hours can only ${r.chatTools.some((t) => t.category === "contact_form") ? "fill in a form and wait" : "call during office hours"}. Fise would answer them straight away and pass you their details to follow up.`,
    });
    return;
  }
  const { settings } = { settings: getSettings() };
  const out = await writeComparison({
    businessName: lead.business_name,
    industry: lead.industry ?? lead.keyword ?? "",
    observations,
    hasChat: hasRealChat(r.chatTools),
    afterHoursAngle: r.afterHoursAngle,
    productFacts: settings.profile.benefits,
  });
  updateLead(leadId, { comparison: out.comparison });
}
