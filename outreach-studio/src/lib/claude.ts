// All Claude API calls. Uses structured outputs (Zod) so responses are always valid JSON.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { config } from "./config";
import { recordUsage } from "./db";

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!config.anthropicKey) throw new ClaudeUnavailable("ANTHROPIC_API_KEY is not set");
  client ??= new Anthropic({ apiKey: config.anthropicKey });
  return client;
}

export class ClaudeUnavailable extends Error {}

export function claudeEnabled() {
  return Boolean(config.anthropicKey);
}

async function structured<T extends z.ZodType>(opts: {
  schema: T;
  system: string;
  prompt: string;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
  label: string;
}): Promise<z.infer<T>> {
  const response = await anthropic().messages.parse({
    model: config.claudeModel,
    max_tokens: opts.maxTokens ?? 16000,
    system: opts.system,
    output_config: { format: zodOutputFormat(opts.schema), effort: opts.effort ?? "medium" },
    messages: [{ role: "user", content: opts.prompt }],
  });
  recordUsage("claude", response.usage.input_tokens + response.usage.output_tokens, 0, opts.label);
  if (response.stop_reason === "refusal") throw new ClaudeUnavailable(`Claude declined the ${opts.label} request`);
  if (response.stop_reason === "max_tokens") throw new Error(`Claude ran out of tokens on ${opts.label}`);
  if (!response.parsed_output) throw new Error(`Claude returned no parseable output for ${opts.label}`);
  return response.parsed_output as z.infer<T>;
}

// ---------------------------------------------------------------------------------------------
// 1. Site research summary

export const ResearchSchema = z.object({
  industry: z.string().describe("Short industry label, e.g. 'Residential electrician'"),
  services: z.array(z.string()).describe("Up to 8 services they explicitly offer"),
  location: z.string().describe("Suburb/city they serve, or empty string if unknown"),
  tone: z.string().describe("Two or three words describing their tone of voice"),
  ownerName: z.string().nullable().describe("Owner/manager full name ONLY if explicitly stated on the pages"),
  ownerRole: z.string().nullable(),
  ownerEvidence: z.string().nullable().describe("Exact short quote from the page that names the owner"),
  teamSizeEstimate: z.number().nullable().describe("Only if the pages state or clearly show it"),
  ownerRunLikely: z.boolean(),
  corporateSignals: z.array(z.string()).describe("Evidence it is a large/corporate business (head office, investor relations, national call centre...)"),
  chainSignals: z.array(z.string()).describe("Evidence of a chain/franchise/multiple branches"),
  likelyCustomerQuestions: z.array(z.string()).describe("5 realistic questions their website visitors would ask"),
  afterHoursAngle: z.string().describe("One sentence on when their customers are likely to enquire outside office hours, grounded in the business type"),
});
export type ResearchSummary = z.infer<typeof ResearchSchema>;

export async function summariseSite(input: {
  businessName: string;
  url: string;
  pages: { url: string; text: string }[];
  hours?: string[];
}): Promise<ResearchSummary> {
  const pageText = input.pages
    .map((p) => `--- PAGE ${p.url} ---\n${p.text.slice(0, 6000)}`)
    .join("\n\n");
  return structured({
    schema: ResearchSchema,
    label: "research",
    effort: "low",
    system:
      "You analyse small-business websites for a B2B sales researcher. Only state facts supported by the page text. " +
      "Never invent names, numbers or services. Use null / empty arrays when the pages do not say.",
    prompt:
      `Business: ${input.businessName}\nWebsite: ${input.url}\n` +
      (input.hours?.length ? `Listed opening hours: ${input.hours.join("; ")}\n` : "") +
      `\nPage text:\n${pageText}`,
  });
}

// ---------------------------------------------------------------------------------------------
// 2. Chat-test assessment and "why Fise" comparison

export const ChatAssessmentSchema = z.object({
  looksLikeBot: z.boolean().nullable(),
  capturesLeads: z.boolean().nullable(),
  booksAppointments: z.boolean().nullable(),
  qualityNote: z.string().describe("One factual sentence about the answer quality, based only on the transcript"),
});

export async function assessChatReply(input: {
  tool: string;
  question: string;
  reply: string | null;
  responseSeconds: number | null;
  afterHours: boolean;
  widgetText: string;
}) {
  return structured({
    schema: ChatAssessmentSchema,
    label: "chat_assessment",
    effort: "low",
    system:
      "You assess a single observed interaction with a website chat widget. Be strictly factual. " +
      "Use null when the transcript does not show something.",
    prompt: JSON.stringify(input, null, 2),
  });
}

export const ComparisonSchema = z.object({
  angle: z.enum(["upgrade", "missing"]),
  comparison: z.string().describe("2-3 sentences, plain and specific. No claims beyond the observations."),
});

export async function writeComparison(input: {
  businessName: string;
  industry: string;
  observations: string[];
  hasChat: boolean;
  afterHoursAngle?: string;
  productFacts: string[];
}) {
  return structured({
    schema: ComparisonSchema,
    label: "comparison",
    effort: "medium",
    system:
      "You write a short, honest 'why Fise would help you' note for one small business. " +
      "Use ONLY the observations provided. Never claim anything about their current tool that is not in the observations. " +
      "If they have no chat tool, use angle 'missing' and describe what they are likely missing (e.g. after-hours enquiries). " +
      "Professional, warm, no hype, no exclamation marks.",
    prompt: JSON.stringify(input, null, 2),
  });
}

// ---------------------------------------------------------------------------------------------
// 3. Email copy

export const EmailCopySchema = z.object({
  subject: z.string(),
  preheader: z.string(),
  greeting: z.string(),
  opening: z.string(),
  benefits: z.array(
    z.object({ title: z.string(), detail: z.string(), exampleQuestion: z.string() }),
  ),
  comparison: z.string(),
  ctaText: z.string(),
  closing: z.string(),
  whatsappMessage: z.string(),
  contactFormMessage: z.string(),
  socialMessage: z.string(),
  smsMessage: z.string(),
});

export const COPY_RULES = `Rules for the email:
- Subject: under 50 characters, includes the business name or their town, sentence case, no spammy punctuation, no emoji.
- Preheader: 40-90 characters, complements the subject.
- Greeting: "Hi {first name}," if a first name is given, otherwise "Hi {business name} team,".
- Opening: 1-2 sentences about something SPECIFIC and factual from their website (a service, their area, how customers reach them). Not generic flattery ("I love your website" is banned).
- Benefits: exactly 2 or 3 items. Each: a short title, one sentence on how Fise helps THIS type of business, and one realistic question their customers would type into the chatbot.
- Comparison: 1-2 sentences using ONLY the provided comparison/observations; empty string if none.
- ctaText: always exactly "Get your free demo" (the app adjusts it). Never offer a call, a meeting, a booking or a time slot, and never mention minutes.
- Closing: 1-2 sentences. Ask whether they'd like to see how a chatbot built from their own website would answer their customers, and say you won't follow up if they'd rather not hear from us. Do not describe the button mechanics; the app adds a line about it under the button.
- Total body (opening + benefits + comparison + closing) must be 120-200 words.
- Professional, warm, plain South African English. No hype, no ALL CAPS words, no exclamation marks, no emoji.
- Never use these words/phrases: free money, act now, guaranteed, 100%, risk-free, limited time, urgent, winner, cash, click here, buy now, no obligation, special promotion, once in a lifetime, amazing, revolutionary.
- whatsappMessage: under 400 characters, introduces the sender and asks permission to share details.
- contactFormMessage: 60-120 words for pasting into their website contact form.
- socialMessage: under 300 characters for a LinkedIn/Facebook/Instagram DM.
- smsMessage: under 300 characters, includes the sender's name and company and ends with "Reply STOP to opt out".`;

export async function writeEmailCopy(input: Record<string, unknown>, feedback?: string[]) {
  return structured({
    schema: EmailCopySchema,
    label: "email_copy",
    effort: "medium",
    system:
      "You are a careful B2B copywriter for Fise, a South African AI website chatbot company. " +
      "You write short, personalised first-touch emails that small business owners actually read. " +
      "You never invent facts about the prospect.\n\n" +
      COPY_RULES,
    prompt:
      `Write the outreach for this prospect.\n\n${JSON.stringify(input, null, 2)}` +
      (feedback?.length
        ? `\n\nYour previous draft broke these rules — fix them:\n- ${feedback.join("\n- ")}`
        : ""),
  });
}

export const FollowupSchema = z.object({
  subject: z.string(),
  preheader: z.string(),
  body: z.string().describe("60-110 words, plain paragraphs separated by blank lines"),
  ctaText: z.string(),
});

export async function writeFollowup(input: Record<string, unknown>) {
  return structured({
    schema: FollowupSchema,
    label: "followup",
    effort: "low",
    system:
      "You write a brief, polite follow-up to a previous outreach email for Fise (AI website chatbots). " +
      "Reference the earlier email, add one new useful point, and keep one call to action. " +
      "No guilt-tripping, no hype, no exclamation marks, no ALL CAPS. Subject under 50 characters.",
    prompt: JSON.stringify(input, null, 2),
  });
}

// ---------------------------------------------------------------------------------------------
// 4. Call brief and call outcome

export const CallBriefSchema = z.object({
  brief: z.string().describe("System prompt for the voice assistant, second person, under 350 words"),
  firstMessage: z.string().describe("Opening line; MUST start by saying it is an automated assistant calling on behalf of the company"),
});

export async function writeCallBrief(input: Record<string, unknown>) {
  return structured({
    schema: CallBriefSchema,
    label: "call_brief",
    effort: "medium",
    system:
      "You prepare a short, polite outbound call brief for an AI voice assistant that calls South African small businesses for Fise. " +
      "Requirements: the assistant identifies itself as an automated assistant calling on behalf of the company in the first sentence; " +
      "explains in one sentence how it got their number (their public website/Google listing); " +
      "the goal is to book a demo or get permission to email details; " +
      "if the person says no, not interested, stop, remove me, or don't call, it apologises, confirms they won't be contacted again, and ends the call; " +
      "it never pressures, never argues, never claims to be human, keeps the call under 2 minutes, and only states facts provided.",
    prompt: JSON.stringify(input, null, 2),
  });
}

export const CallOutcomeSchema = z.object({
  outcome: z.enum(["booked", "interested", "not_interested", "call_back", "do_not_contact", "no_answer", "voicemail"]),
  summary: z.string(),
  callbackTime: z.string().nullable(),
});

export async function classifyCall(transcript: string) {
  return structured({
    schema: CallOutcomeSchema,
    label: "call_outcome",
    effort: "low",
    system:
      "Classify the outcome of a sales call transcript. If the person asked not to be called or contacted again in any way, the outcome is do_not_contact.",
    prompt: transcript.slice(0, 30000),
  });
}

export const ReplySchema = z.object({
  intent: z.enum(["interested", "not_interested", "unsubscribe", "question", "out_of_office", "other"]),
  summary: z.string(),
});

export async function classifyReply(text: string) {
  return structured({
    schema: ReplySchema,
    label: "reply",
    effort: "low",
    system:
      "Classify an email reply to a sales outreach email. 'unsubscribe' means they asked not to be contacted again in any form.",
    prompt: text.slice(0, 8000),
  });
}
