// Fise platform "quickstart" API: builds a real demo chatbot from a website (same API as the
// fise-quickstart skill). The chatbot belongs to an internal system account, not a customer account.
import { config } from "../config";
import type { Lead } from "../types";

function auth() {
  const { token, baseUrl } = config.fiseQuickstart;
  if (!token) throw new Error("Set FISE_QUICKSTART_TOKEN in .env to build demo chatbots");
  return { baseUrl: baseUrl.replace(/\/+$/, ""), headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } };
}

export interface Quickstart {
  create(lead: Lead): Promise<{ chatbotId: string; chatLink: string }>;
  status(chatbotId: string): Promise<{ state: "ready" | "building" | "failed"; chatLink?: string; error?: string }>;
}

export const platformQuickstart: Quickstart = {
  async create(lead) {
    if (!lead.website) throw new Error("This lead has no website to build a chatbot from");
    const { baseUrl, headers } = auth();
    const res = await fetch(`${baseUrl}/api/admin/quickstart`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        website_url: lead.website,
        business_name: lead.business_name,
        name: `${lead.business_name} assistant`.slice(0, 60),
        primary_colour: lead.colors?.primary,
      }),
      signal: AbortSignal.timeout(30000),
    });
    const json = (await res.json().catch(() => ({}))) as { chatbotId?: string; chatLink?: string; error?: string };
    if (!res.ok || !json.chatbotId || !json.chatLink) throw new Error(json.error ?? `Quickstart failed (${res.status})`);
    return { chatbotId: json.chatbotId, chatLink: json.chatLink };
  },
  async status(chatbotId) {
    const { baseUrl, headers } = auth();
    const res = await fetch(`${baseUrl}/api/admin/quickstart/status?id=${encodeURIComponent(chatbotId)}`, { headers, signal: AbortSignal.timeout(20000) });
    const json = (await res.json().catch(() => ({}))) as {
      status?: string; chatLink?: string; error?: string; scan?: { status?: string; error?: string | null } | null;
    };
    if (!res.ok) throw new Error(json.error ?? `Quickstart status failed (${res.status})`);
    if (json.status === "ready") return { state: "ready", chatLink: json.chatLink };
    if (json.scan?.status === "failed" || (json.status === "setup" && json.scan?.error)) {
      return { state: "failed", error: json.scan?.error ?? "The website scan failed" };
    }
    return { state: "building" };
  },
};
