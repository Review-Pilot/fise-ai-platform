// Creates a live demo chatbot on the Fise platform (same admin quickstart API the
// fise-quickstart skill uses) so a prospect's landing page can link to a working bot.
import { config } from "./config";
import { getLead, updateLead } from "./leads";
import { logEvent } from "./db";

export async function createDemoChatbot(leadId: string): Promise<string> {
  const lead = getLead(leadId);
  if (!lead?.website) throw new Error("Lead has no website");
  const { token, baseUrl } = config.fiseQuickstart;
  if (!token) throw new Error("Set FISE_QUICKSTART_TOKEN in .env to create live demo chatbots");
  const res = await fetch(`${baseUrl}/api/admin/quickstart`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      website_url: lead.website,
      business_name: lead.business_name,
      name: `${lead.business_name} assistant`.slice(0, 60),
      primary_colour: lead.colors?.primary,
    }),
    signal: AbortSignal.timeout(30000),
  });
  const json = (await res.json().catch(() => ({}))) as { chatLink?: string; error?: string };
  if (!res.ok || !json.chatLink) throw new Error(json.error ?? `Quickstart failed (${res.status})`);
  updateLead(leadId, { demo_chat_link: json.chatLink });
  logEvent(leadId, "system", "demo_created", json.chatLink);
  return json.chatLink;
}
