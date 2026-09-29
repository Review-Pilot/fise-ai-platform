// Detects existing chat / support tools on a website from its HTML.
import type { ChatTool } from "../types";

interface WidgetSig {
  id: string;
  name: string;
  category: ChatTool["category"];
  patterns: RegExp[];
  /** JS used by the chat test to open the widget (runs in the page). */
  openScript?: string;
}

export const WIDGETS: WidgetSig[] = [
  { id: "tawk", name: "Tawk.to", category: "live_chat", patterns: [/embed\.tawk\.to/i, /Tawk_API/], openScript: "window.Tawk_API && Tawk_API.maximize && Tawk_API.maximize()" },
  { id: "intercom", name: "Intercom", category: "live_chat", patterns: [/widget\.intercom\.io/i, /intercomSettings/, /js\.intercomcdn\.com/i], openScript: "window.Intercom && Intercom('show')" },
  { id: "drift", name: "Drift", category: "live_chat", patterns: [/js\.driftt\.com/i, /drift\.load\(/i], openScript: "window.drift && drift.api && drift.api.openChat()" },
  { id: "tidio", name: "Tidio", category: "live_chat", patterns: [/code\.tidio\.co/i, /tidioChatApi/], openScript: "window.tidioChatApi && tidioChatApi.open()" },
  { id: "livechat", name: "LiveChat", category: "live_chat", patterns: [/cdn\.livechatinc\.com/i, /__lc\.license/], openScript: "window.LiveChatWidget && LiveChatWidget.call('maximize')" },
  { id: "crisp", name: "Crisp", category: "live_chat", patterns: [/client\.crisp\.chat/i, /CRISP_WEBSITE_ID/], openScript: "window.$crisp && $crisp.push(['do','chat:open'])" },
  { id: "hubspot", name: "HubSpot chat", category: "live_chat", patterns: [/js\.hs-scripts\.com/i, /js\.usemessages\.com/i, /HubSpotConversations/], openScript: "window.HubSpotConversations && HubSpotConversations.widget && HubSpotConversations.widget.open()" },
  { id: "zendesk", name: "Zendesk", category: "live_chat", patterns: [/static\.zdassets\.com/i, /zE\(/], openScript: "window.zE && (zE('messenger','open'), zE('webWidget','open'))" },
  { id: "freshchat", name: "Freshchat", category: "live_chat", patterns: [/wchat\.freshchat\.com/i, /fcWidget/], openScript: "window.fcWidget && fcWidget.open()" },
  { id: "olark", name: "Olark", category: "live_chat", patterns: [/static\.olark\.com/i, /olark\.identify/] , openScript: "window.olark && olark('api.box.expand')" },
  { id: "smartsupp", name: "Smartsupp", category: "live_chat", patterns: [/smartsuppchat\.com/i, /_smartsupp/], openScript: "window.smartsupp && smartsupp('chat:open')" },
  { id: "jivo", name: "JivoChat", category: "live_chat", patterns: [/code\.jivosite\.com/i, /jivo_api/i], openScript: "window.jivo_api && jivo_api.open()" },
  { id: "chatra", name: "Chatra", category: "live_chat", patterns: [/call\.chatra\.io/i, /ChatraID/], openScript: "window.Chatra && Chatra('openChat', true)" },
  { id: "gorgias", name: "Gorgias", category: "live_chat", patterns: [/config\.gorgias\.chat/i] },
  { id: "chatbase", name: "Chatbase", category: "ai_chatbot", patterns: [/chatbase\.co\/embed/i, /www\.chatbase\.co/i] },
  { id: "botpress", name: "Botpress", category: "ai_chatbot", patterns: [/cdn\.botpress\.cloud/i, /botpressWebChat/i] },
  { id: "voiceflow", name: "Voiceflow", category: "ai_chatbot", patterns: [/cdn\.voiceflow\.com/i, /voiceflow\.chat/i] },
  { id: "landbot", name: "Landbot", category: "ai_chatbot", patterns: [/landbot\.io/i] },
  { id: "manychat", name: "ManyChat", category: "ai_chatbot", patterns: [/manychat\.com/i] },
  { id: "tiledesk", name: "Tiledesk", category: "ai_chatbot", patterns: [/tiledesk\.com/i] },
  { id: "fise", name: "Fise", category: "ai_chatbot", patterns: [/fise-ai-platform/i, /fise\.chat/i] },
  { id: "fb_messenger", name: "Facebook Messenger chat", category: "messenger", patterns: [/fb-customerchat/i, /xfbml\.customerchat/i] },
  { id: "whatsapp", name: "WhatsApp button", category: "whatsapp", patterns: [/wa\.me\/\d/i, /api\.whatsapp\.com\/send/i, /joinchat/i, /click-to-chat/i, /whatsapp-button/i, /elfsight.*whatsapp/i] },
];

export function detectChatTools(html: string): ChatTool[] {
  const found: ChatTool[] = [];
  for (const w of WIDGETS) {
    const hit = w.patterns.find((p) => p.test(html));
    if (hit) found.push({ id: w.id, name: w.name, category: w.category, evidence: hit.source });
  }
  if (
    /<form[\s\S]{0,4000}?<textarea/i.test(html) ||
    /(wpcf7|gform_wrapper|wpforms|elementor-form|hs-form|ninja-forms|formspree|jotform|typeform|forminator)/i.test(html)
  ) {
    found.push({ id: "contact_form", name: "Contact form", category: "contact_form", evidence: "form with message field" });
  }
  return found;
}

export function hasRealChat(tools: ChatTool[]): boolean {
  return tools.some((t) => t.category === "ai_chatbot" || t.category === "live_chat" || t.category === "messenger");
}

export function openScriptFor(id: string): string | undefined {
  return WIDGETS.find((w) => w.id === id)?.openScript;
}
