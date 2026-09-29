// Environment configuration. Every secret comes from .env — nothing is hard-coded.
import path from "node:path";

function env(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

export const config = {
  get publicBaseUrl() {
    return env("PUBLIC_BASE_URL", "http://localhost:3100").replace(/\/+$/, "");
  },
  get dataDir() {
    return path.resolve(env("DATA_DIR", path.join(process.cwd(), "data")));
  },
  get appPassword() {
    return env("APP_PASSWORD");
  },
  get appSecret() {
    return env("APP_SECRET", "dev-only-insecure-secret-change-me");
  },
  get anthropicKey() {
    return env("ANTHROPIC_API_KEY");
  },
  get claudeModel() {
    return env("CLAUDE_MODEL", "claude-opus-5-5");
  },
  get googlePlacesKey() {
    return env("GOOGLE_PLACES_API_KEY");
  },
  get resendKey() {
    return env("RESEND_API_KEY");
  },
  get resendWebhookSecret() {
    return env("RESEND_WEBHOOK_SECRET");
  },
  get fromEmail() {
    return env("FROM_EMAIL"); // e.g. "Sam at Fise <sam@mail.fise.co.za>"
  },
  get replyToEmail() {
    return env("REPLY_TO_EMAIL");
  },
  get sendingDomain() {
    return env("SENDING_DOMAIN"); // e.g. mail.fise.co.za
  },
  get dkimSelector() {
    return env("DKIM_SELECTOR", "resend");
  },
  /** Extra domains you own that email links may point to (comma separated). */
  get extraLinkDomains() {
    return env("ALLOWED_LINK_DOMAINS")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  },
  get imap() {
    return {
      host: env("IMAP_HOST"),
      port: Number(env("IMAP_PORT", "993")),
      user: env("IMAP_USER"),
      pass: env("IMAP_PASSWORD"),
    };
  },
  get vapi() {
    return {
      apiKey: env("VAPI_API_KEY"),
      phoneNumberId: env("VAPI_PHONE_NUMBER_ID"),
      assistantId: env("VAPI_ASSISTANT_ID"),
      webhookSecret: env("VAPI_WEBHOOK_SECRET"),
    };
  },
  get twilio() {
    return {
      accountSid: env("TWILIO_ACCOUNT_SID"),
      authToken: env("TWILIO_AUTH_TOKEN"),
      from: env("TWILIO_FROM_NUMBER"),
    };
  },
  get fiseQuickstart() {
    return {
      token: env("FISE_QUICKSTART_TOKEN"),
      baseUrl: env("FISE_PLATFORM_URL", "https://fise-ai-platform.seb-slabbert1.workers.dev"),
    };
  },
  get chromiumPath() {
    return env("CHROMIUM_PATH");
  },
  get extraHolidays() {
    return env("EXTRA_HOLIDAYS")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  },
};

export function ownDomains(): string[] {
  const hosts = new Set<string>(config.extraLinkDomains);
  try {
    hosts.add(new URL(config.publicBaseUrl).hostname.toLowerCase());
  } catch {
    /* ignore */
  }
  return [...hosts];
}

export function integrationStatus() {
  return {
    claude: Boolean(config.anthropicKey),
    places: Boolean(config.googlePlacesKey),
    resend: Boolean(config.resendKey && config.fromEmail),
    imap: Boolean(config.imap.host && config.imap.user),
    vapi: Boolean(config.vapi.apiKey && config.vapi.phoneNumberId && config.vapi.assistantId),
    twilio: Boolean(config.twilio.accountSid && config.twilio.authToken && config.twilio.from),
    fiseQuickstart: Boolean(config.fiseQuickstart.token),
    auth: Boolean(config.appPassword),
  };
}
