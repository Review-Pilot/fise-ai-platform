// Fit scoring (0–100) with plain-English reasons, plus hard exclusions.
import type { ContactDetail, PlaceSummary, SiteResearch } from "./types";
import type { Settings } from "./settings";
import { hasRealChat } from "./site/widgets";

/** Well-known SA chains/brands and corporate groups — excluded as not SMB. Extend in code as needed. */
const BIG_BRANDS = [
  "spar", "pick n pay", "checkers", "shoprite", "woolworths", "discovery", "netcare", "mediclinic", "life healthcare",
  "builders warehouse", "midas", "tiger wheel", "bidvest", "dis-chem", "clicks", "engen", "shell", "sasol", "vodacom",
  "mtn", "telkom", "capitec", "fnb", "absa", "nedbank", "standard bank", "mr price", "pep ", "ackermans", "hollard",
  "old mutual", "sanlam", "mcdonald", "kfc", "nando", "spur", "wimpy", "steers", "debonairs", "ocean basket",
  "virgin active", "planet fitness", "kauai", "vida e caff", "mugg & bean", "re/max", "remax", "pam golding", "seeff",
  "harcourts", "chas everitt", "lew geffen", "rawson", "jawitz", "leadhome", "outsurance", "santam", "momentum",
  "liberty", "toyota", "volkswagen", "bmw", "mercedes-benz", "hyundai", "ford ", "cashbuild", "game stores", "makro",
  "incredible connection", "takealot", "edgars", "truworths", "specsavers", "spec-savers", "torga optical",
  "chemical guys", "supaquick", "hi-q", "bridgestone", "goodyear", "servest", "rentokil", "flick", "adt ", "fidelity",
];

export interface QualificationInput {
  businessName: string;
  research: SiteResearch | null;
  place: PlaceSummary | null;
  contacts: ContactDetail[];
  locations: number;
  isManual: boolean;
}

export interface QualificationResult {
  qualified: boolean;
  disqualifyReason: string | null;
  score: number;
  reason: string;
}

export function isBigBrand(name: string): boolean {
  const n = ` ${name.toLowerCase()} `;
  return BIG_BRANDS.some((b) => n.includes(` ${b.trim()}`));
}

export function qualify(input: QualificationInput, q: Settings["qualification"]): QualificationResult {
  const r = input.research;
  const plus: string[] = [];
  const minus: string[] = [];
  const excludes: string[] = [];
  let score = 40;

  if (!r) {
    return { qualified: false, disqualifyReason: "Website not analysed", score: 0, reason: "No website analysis" };
  }
  if (r.socialOnly) excludes.push("Only a social media page, not a website");
  if (r.httpStatus !== 200) excludes.push(`Website returned HTTP ${r.httpStatus}`);
  if (r.parked) excludes.push(`Website is parked/placeholder (${r.parkedReason})`);
  if (r.canInstall === "no" && q.excludeCantInstall) excludes.push(`Can't install chatbot: ${r.canInstallReason}`);

  // --- Size: reviews, locations, team, corporate/chain signals
  const reviews = input.place?.reviewCount;
  if (reviews !== undefined && reviews !== null) {
    if (reviews > q.maxReviews) excludes.push(`${reviews} reviews — above the ${q.maxReviews} limit (likely too big)`);
    else if (reviews < q.minReviews) excludes.push(`${reviews} reviews — below the ${q.minReviews} minimum`);
    else {
      score += 10;
      plus.push(`${reviews} reviews`);
      if (reviews >= 20 && reviews <= 150) score += 5;
    }
  }
  if (input.locations > q.maxLocations) excludes.push(`${input.locations} Google listings share this website (chain)`);
  if (isBigBrand(input.businessName)) excludes.push("Known national brand/chain");
  if (r.chainSignals.length >= 2) excludes.push(`Chain/franchise signals: ${r.chainSignals.slice(0, 2).join("; ")}`);
  else if (r.chainSignals.length === 1) {
    score -= 10;
    minus.push("possible multiple branches");
  }
  if (r.teamSizeEstimate && r.teamSizeEstimate > q.maxTeamSize) excludes.push(`Team of ~${r.teamSizeEstimate} (above ${q.maxTeamSize})`);
  if (r.corporateSignals.length >= 2) excludes.push(`Corporate signals: ${r.corporateSignals.slice(0, 2).join("; ")}`);
  else if (r.corporateSignals.length === 1) {
    score -= 10;
    minus.push("some corporate signals");
  }
  if (r.ownerRunLikely) {
    score += 10;
    plus.push("looks owner-run");
  }

  // --- Chat situation
  const aiBot = r.chatTools.some((t) => t.category === "ai_chatbot");
  const live = r.chatTools.filter((t) => t.category === "live_chat" || t.category === "messenger");
  const form = r.chatTools.some((t) => t.category === "contact_form");
  const wa = r.chatTools.some((t) => t.category === "whatsapp");
  if (aiBot) {
    if (q.excludeExistingAiChatbot) excludes.push("Already has an AI chatbot");
    score -= 15;
    minus.push(`already has ${r.chatTools.find((t) => t.category === "ai_chatbot")!.name}`);
  } else if (live.length) {
    score += 8;
    plus.push(`${live[0].name} live chat (upgrade angle)`);
  } else if (!hasRealChat(r.chatTools)) {
    score += 20;
    plus.push("no chat widget");
    if (form) {
      score += 5;
      plus.push("contact form only");
    }
    if (wa) plus.push("WhatsApp button");
  }

  // --- Install ease
  if (r.canInstall === "yes") {
    score += 10;
    plus.push(`${r.platform} = easy install`);
  } else if (r.canInstall === "likely") {
    score += 4;
    plus.push(`${r.platform} (plan-dependent install)`);
  } else {
    score -= 20;
    minus.push("can't install");
  }

  // --- Reachability
  const named = input.contacts.some((c) => c.kind === "email" && c.emailType === "named" && c.valid !== false);
  const anyEmail = input.contacts.some((c) => c.kind === "email" && c.valid !== false && c.emailType !== "support");
  if (named) {
    score += 7;
    plus.push("named owner email");
  } else if (anyEmail) score += 3;
  else {
    score -= 5;
    minus.push("no usable email");
  }

  // --- After-hours demand (closed evenings/weekends per Google hours)
  const hours = input.place?.hours ?? [];
  if (hours.some((h) => /closed/i.test(h)) || hours.some((h) => /(4|5|6):\d\d\s*PM/i.test(h))) {
    score += 5;
    plus.push("closed after hours");
  }
  if (input.place?.rating && input.place.rating >= 4.3) score += 3;

  score = Math.max(0, Math.min(100, Math.round(score)));
  const reason =
    [plus.length ? plus.map(capitalise).join(", ") : "", minus.length ? `but ${minus.join(", ")}` : ""]
      .filter(Boolean)
      .join(" — ") || "Not enough information";

  const hardExclusion = excludes[0] ?? null;
  // Manually entered prospects are never auto-dropped — they're only warned.
  const qualified = input.isManual ? true : !hardExclusion && score >= q.minFitScore;
  const disqualifyReason = input.isManual
    ? null
    : hardExclusion ?? (score < q.minFitScore ? `Fit score ${score} is below ${q.minFitScore}` : null);
  return { qualified, disqualifyReason, score: hardExclusion && !input.isManual ? Math.min(score, 20) : score, reason };
}

function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
