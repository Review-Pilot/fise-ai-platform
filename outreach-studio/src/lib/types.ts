export const LEAD_STATUSES = [
  "New",
  "Qualified",
  "Contacted",
  "Replied",
  "Demo booked",
  "Won",
  "Lost",
  "Do not contact",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export type ContactKind =
  | "email"
  | "phone"
  | "whatsapp"
  | "contact_form"
  | "facebook"
  | "instagram"
  | "linkedin"
  | "twitter"
  | "tiktok"
  | "youtube";

export interface ContactDetail {
  kind: ContactKind;
  value: string;
  /** The page the detail was found on — shown in the UI and kept for POPIA records. */
  sourceUrl: string;
  foundAt: string;
  /** For emails: owner (named person), generic (info@), support (support@/noreply). */
  emailType?: "named" | "generic" | "support";
  /** Result of syntax + MX validation for emails. */
  valid?: boolean;
  validationNote?: string;
  personName?: string;
  personRole?: string;
}

export type BestRoute = "owner_email" | "generic_email" | "phone" | "whatsapp" | "contact_form" | "none";

export interface BrandColors {
  primary: string;
  secondary: string;
  accent: string;
  /** Text colours that pass WCAG AA on each of the above. */
  onPrimary: string;
  onSecondary: string;
  onAccent: string;
  source: "site" | "manual" | "default";
  notes?: string[];
}

export interface ChatTool {
  id: string;
  name: string;
  category: "ai_chatbot" | "live_chat" | "whatsapp" | "messenger" | "contact_form";
  evidence: string;
}

export interface SiteResearch {
  finalUrl: string;
  httpStatus: number;
  fetchedAt: string;
  pages: { url: string; status: number; title?: string }[];
  blockedByRobots: string[];
  parked: boolean;
  parkedReason?: string;
  socialOnly: boolean;
  platform: string;
  platformEvidence: string[];
  canInstall: "yes" | "likely" | "no";
  canInstallReason: string;
  chatTools: ChatTool[];
  logoUrl?: string;
  faviconUrl?: string;
  title?: string;
  description?: string;
  /** From Claude (or heuristics when Claude is unavailable). */
  industry?: string;
  services: string[];
  location?: string;
  tone?: string;
  ownerName?: string;
  ownerRole?: string;
  ownerEvidence?: string;
  teamSizeEstimate?: number | null;
  ownerRunLikely?: boolean;
  corporateSignals: string[];
  chainSignals: string[];
  likelyCustomerQuestions: string[];
  afterHoursAngle?: string;
  wordCount: number;
}

export interface ChatTestResult {
  ranAt: string;
  localTime: string;
  afterHours: boolean;
  tool?: string;
  opened: boolean;
  question: string;
  reply?: string;
  responseSeconds?: number | null;
  looksLikeBot?: boolean | null;
  capturesLeads?: boolean | null;
  booksAppointments?: boolean | null;
  qualityNote?: string;
  observations: string[];
  screenshotFile?: string;
  error?: string;
}

export interface PlaceSummary {
  placeId: string;
  name: string;
  address?: string;
  phone?: string;
  website?: string;
  rating?: number;
  reviewCount?: number;
  category?: string;
  hours?: string[];
  businessStatus?: string;
  location?: { lat: number; lng: number };
}

export interface Lead {
  id: string;
  source: string;
  place_id: string | null;
  search_id: string | null;
  business_name: string;
  contact_first_name: string | null;
  website: string | null;
  domain: string | null;
  city: string | null;
  keyword: string | null;
  industry: string | null;
  locations: number;
  status: LeadStatus;
  qualified: number | null;
  disqualify_reason: string | null;
  fit_score: number | null;
  fit_reason: string | null;
  platform: string | null;
  can_install: string | null;
  has_chatbot: number | null;
  best_route: BestRoute | null;
  research_status: string;
  research_error: string | null;
  research: SiteResearch | null;
  contacts: ContactDetail[];
  colors: BrandColors | null;
  chat_test_approved: number;
  chat_test: ChatTestResult | null;
  comparison: string | null;
  notes: string | null;
  consent_status: "none" | "requested" | "granted" | "refused";
  demo_chat_link: string | null;
  demo_offer: number | null;
  demo_status: "none" | "building" | "ready" | "failed";
  demo_error: string | null;
  demo_chatbot_id: string | null;
  demo_notify: number;
  demo_started_at: string | null;
  demo_requested_at: string | null;
  demo_emailed_at: string | null;
  demo_photo: string | null;
  demo_photo_alt: string | null;
  landing_slug: string | null;
  last_contacted_at: string | null;
  replied_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailCopy {
  subject: string;
  preheader: string;
  greeting: string;
  opening: string;
  benefits: { title: string; detail: string; exampleQuestion: string }[];
  comparison: string;
  ctaText: string;
  closing: string;
  whatsappMessage: string;
  contactFormMessage: string;
  socialMessage: string;
  smsMessage: string;
}

export interface EmailCheck {
  id: string;
  label: string;
  ok: boolean;
  severity: "error" | "warning";
  detail?: string;
}
