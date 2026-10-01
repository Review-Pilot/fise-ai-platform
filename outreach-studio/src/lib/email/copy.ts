// Builds the prospect brief, asks Claude for copy (retrying with rule feedback), or uses a template.
import type { EmailCopy, Lead } from "../types";
import { getSettings } from "../settings";
import { claudeEnabled, writeEmailCopy, ClaudeUnavailable } from "../claude";
import { validateCopy, wordCount, copyBodyText } from "./rules";
import { hasRealChat } from "../site/widgets";
import { logEvent } from "../db";
import { CTA_DEMO } from "../demo/offer";

export function prospectBrief(lead: Lead) {
  const s = getSettings();
  const r = lead.research;
  return {
    prospect: {
      businessName: lead.business_name,
      contactFirstName: lead.contact_first_name,
      industry: r?.industry ?? lead.industry ?? lead.keyword,
      services: r?.services ?? [],
      location: r?.location ?? lead.city,
      toneOfVoice: r?.tone,
      websiteTitle: r?.title,
      websiteDescription: r?.description,
      existingChatTools: r?.chatTools.map((t) => `${t.name} (${t.category})`) ?? [],
      likelyCustomerQuestions: r?.likelyCustomerQuestions ?? [],
      afterHoursAngle: r?.afterHoursAngle,
      myNotes: lead.notes,
    },
    comparison: lead.comparison,
    chatTestObservations: lead.chat_test?.observations ?? [],
    consentFirst: s.consent.consentFirstMode,
    fise: {
      description: s.profile.description,
      benefits: s.profile.benefits,
      offer: s.profile.offer,
    },
    sender: { name: s.profile.senderName, title: s.profile.senderTitle, company: s.profile.company },
  };
}

/** Deterministic copy used when Claude isn't configured or fails. */
export function templateCopy(lead: Lead): EmailCopy {
  const s = getSettings();
  const r = lead.research;
  const industry = (r?.industry || lead.keyword || "business").toLowerCase();
  // Lower-case only a leading capital of an ordinary word (keeps acronyms like "COC").
  const rawService = r?.services?.[0];
  const service = rawService && /^[A-Z][a-z]/.test(rawService) ? rawService[0].toLowerCase() + rawService.slice(1) : rawService;
  const place = r?.location || lead.city || "your area";
  const qs = r?.likelyCustomerQuestions?.length ? r.likelyCustomerQuestions : ["Do you service my area?", "Can I get a quote this week?", "What are your hours?"];
  const hasChat = r ? hasRealChat(r.chatTools) : false;
  const greeting = lead.contact_first_name ? `Hi ${lead.contact_first_name},` : `Hi ${lead.business_name} team,`;
  const opening = service
    ? `I was looking at ${lead.business_name}'s website and saw that you offer ${service} in ${place}. Customers looking for that often have a quick question before they pick up the phone.`
    : `I was looking at ${lead.business_name}'s website and the ${industry} work you do in ${place}. Customers in your line of work often have a quick question before they pick up the phone.`;
  const closing = s.consent.consentFirstMode
    ? `Would you like to see how a chatbot built from your own website content would answer your customers? If you'd rather not hear from us, just say so and I won't follow up.`
    : `I can build a demo from your own website content so you can see exactly how it would answer your customers.`;
  const copy: EmailCopy = {
    subject: `A website assistant for ${lead.business_name}`.slice(0, 49),
    preheader: `How ${lead.business_name} could answer customer questions after hours`,
    greeting,
    opening,
    benefits: [
      {
        title: "Answers questions after hours",
        detail: `Fise answers visitors in seconds using your own website content, even at night and over weekends when your team is busy or closed.`,
        exampleQuestion: qs[0],
      },
      {
        title: "Captures the enquiry for you",
        detail: `When someone is ready, it takes their name, number and job details and sends them straight to you, so fewer enquiries go cold.`,
        exampleQuestion: qs[1] ?? "Can someone call me back tomorrow?",
      },
      {
        title: "Helps customers book",
        detail: `It points people to the right service and your booking or quote process instead of leaving them to search the site.`,
        exampleQuestion: qs[2] ?? "Can I book for this week?",
      },
    ],
    comparison: lead.comparison ?? (hasChat ? "" : "At the moment, visitors who arrive after hours have no way to get an answer straight away."),
    ctaText: CTA_DEMO,
    closing,
    whatsappMessage: `Hi, this is ${s.profile.senderName} from ${s.profile.company}. I found ${lead.business_name}'s number on your website. We build AI chatbots that answer customer questions on your site after hours. May I send you a free demo? If not, no problem and I won't message again.`,
    contactFormMessage: `Hi ${lead.business_name} team, I'm ${s.profile.senderName} from ${s.profile.company}. We build AI website chatbots for small businesses that answer customer questions in seconds, day and night, and pass the enquiry details to you. I had a look at your site and think it could help with questions like "${qs[0]}". Would you be open to a free demo built on your own website content? If not, no problem at all. Kind regards, ${s.profile.senderName}, ${s.profile.phone}`,
    socialMessage: `Hi, I'm ${s.profile.senderName} from ${s.profile.company}. We build AI chatbots that answer website visitors' questions after hours. I think it could suit ${lead.business_name}. Open to a free demo?`,
    smsMessage: `Hi, ${s.profile.senderName} from ${s.profile.company} here. We build AI chatbots that answer your website visitors after hours. May I email you a free demo for ${lead.business_name}? Reply STOP to opt out`,
  };
  // Pad/trim to stay within 120–200 words.
  const wc = wordCount(copyBodyText(copy));
  if (wc > 200) copy.benefits = copy.benefits.slice(0, 2);
  return copy;
}

export async function generateCopy(lead: Lead): Promise<{ copy: EmailCopy; issues: string[]; source: "claude" | "template" }> {
  if (claudeEnabled()) {
    try {
      const brief = prospectBrief(lead);
      let copy = (await writeEmailCopy(brief)) as EmailCopy;
      let issues = validateCopy(copy);
      for (let attempt = 0; issues.length && attempt < 2; attempt++) {
        copy = (await writeEmailCopy(brief, issues)) as EmailCopy;
        issues = validateCopy(copy);
      }
      return { copy, issues, source: "claude" };
    } catch (e) {
      logEvent(lead.id, "email", "claude_error", e instanceof ClaudeUnavailable ? e.message : String(e));
    }
  }
  const copy = templateCopy(lead);
  return { copy, issues: validateCopy(copy), source: "template" };
}
