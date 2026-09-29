import { db } from "./db";

export interface FiseProfile {
  productName: string;
  description: string;
  benefits: string[];
  offer: string;
  websiteUrl: string;
  demoUrl: string;
  senderName: string;
  senderTitle: string;
  company: string;
  address: string;
  phone: string;
  defaultColors: { primary: string; secondary: string; accent: string };
}

export interface Settings {
  profile: FiseProfile;
  budget: {
    monthlyUsd: number;
    /** USD per 1,000 requests. Check Google's current price list — these are editable estimates. */
    textSearchPer1000: number;
    placeDetailsPer1000: number;
  };
  places: { cacheDays: number };
  qualification: {
    minReviews: number;
    maxReviews: number;
    maxLocations: number;
    maxTeamSize: number;
    minFitScore: number;
    excludeCantInstall: boolean;
    excludeExistingAiChatbot: boolean;
  };
  consent: {
    /** POPIA s69: first electronic message asks for consent; follow-ups/calls/SMS need consent. */
    consentFirstMode: boolean;
  };
  sending: {
    paused: boolean;
    pauseReason: string | null;
    warmupStartPerDay: number;
    warmupIncreasePerWeek: number;
    maxPerDay: number;
    perDomainPerDay: number;
    minDelaySeconds: number;
    maxDelaySeconds: number;
    bounceRateLimit: number;
    firstSendDate: string | null;
    dnsVerifiedAt: string | null;
  };
  sequence: { followup1Days: number; followup2Days: number };
  calls: {
    testMode: boolean;
    testNumber: string;
    testPassedAt: string | null;
    dailyCap: number;
    recordCalls: boolean;
  };
  landingPages: { enabled: boolean };
}

export const DEFAULT_SETTINGS: Settings = {
  profile: {
    productName: "Fise",
    description:
      "Fise builds straightforward AI chatbots for business websites. Your chatbot answers customer questions in seconds, day and night, captures enquiries and helps visitors book.",
    benefits: [
      "Answers customer questions in seconds, 24/7, in your business's own words",
      "Captures names, numbers and job details from after-hours visitors",
      "Guides visitors to book or request a quote instead of leaving",
      "Installs with one short snippet on WordPress, Wix, Shopify, Squarespace and most sites",
      "Plans from R500/month with no long contracts",
    ],
    offer: "a free, no-obligation demo built on your own website content",
    websiteUrl: "https://fise-ai-platform.seb-slabbert1.workers.dev",
    demoUrl: "https://fise-ai-platform.seb-slabbert1.workers.dev",
    senderName: "Your Name",
    senderTitle: "Founder",
    company: "Fise AI",
    address: "Your registered business address, Cape Town, South Africa",
    phone: "+27 00 000 0000",
    defaultColors: { primary: "#1769e0", secondary: "#0f2a4a", accent: "#12b886" },
  },
  budget: { monthlyUsd: 50, textSearchPer1000: 35, placeDetailsPer1000: 20 },
  places: { cacheDays: 30 },
  qualification: {
    minReviews: 5,
    maxReviews: 300,
    maxLocations: 2,
    maxTeamSize: 50,
    minFitScore: 50,
    excludeCantInstall: true,
    excludeExistingAiChatbot: false,
  },
  consent: { consentFirstMode: true },
  sending: {
    paused: false,
    pauseReason: null,
    warmupStartPerDay: 20,
    warmupIncreasePerWeek: 10,
    maxPerDay: 100,
    perDomainPerDay: 2,
    minDelaySeconds: 90,
    maxDelaySeconds: 300,
    bounceRateLimit: 0.03,
    firstSendDate: null,
    dnsVerifiedAt: null,
  },
  sequence: { followup1Days: 4, followup2Days: 9 },
  calls: { testMode: true, testNumber: "", testPassedAt: null, dailyCap: 20, recordCalls: false },
  landingPages: { enabled: true },
};

type Section = keyof Settings;

export function getSettings(): Settings {
  const rows = db().prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const stored = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
  const out = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (stored[key] && typeof stored[key] === "object") {
      out[key] = { ...(out[key] as object), ...stored[key] };
    }
  }
  return out as unknown as Settings;
}

export function updateSettings<K extends Section>(section: K, patch: Partial<Settings[K]>): Settings[K] {
  const current = getSettings()[section];
  const next = { ...current, ...patch };
  db()
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(section, JSON.stringify(next));
  return next;
}
