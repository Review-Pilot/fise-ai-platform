// Resend delivery webhooks (Svix-signed): bounces and complaints feed the safety stops.
import { verifySvix } from "@/lib/svix";
import { config } from "@/lib/config";
import { db, logEvent } from "@/lib/db";
import { addDnc } from "@/lib/dnc";
import { optOut } from "@/lib/optout";
import { enforceSafetyStops } from "@/lib/sending";

export async function POST(req: Request) {
  const body = await req.text();
  if (!verifySvix(body, req.headers, config.resendWebhookSecret)) return new Response("Invalid signature", { status: 401 });
  const evt = JSON.parse(body) as { type: string; data: { email_id?: string; to?: string[]; bounce?: { type?: string; message?: string } } };
  const row = evt.data.email_id
    ? (db().prepare("SELECT id, lead_id, to_email FROM emails WHERE provider_id = ?").get(evt.data.email_id) as { id: string; lead_id: string; to_email: string } | undefined)
    : undefined;
  const to = row?.to_email ?? evt.data.to?.[0];
  switch (evt.type) {
    case "email.delivered":
      logEvent(row?.lead_id ?? null, "email", "delivered", to);
      break;
    case "email.bounced": {
      const soft = /transient|soft/i.test(evt.data.bounce?.type ?? "");
      logEvent(row?.lead_id ?? null, "email", soft ? "soft_bounce" : "bounce", `${to}: ${evt.data.bounce?.message ?? evt.data.bounce?.type ?? ""}`);
      if (!soft && to) addDnc(to, "Hard bounce", "resend", row?.lead_id);
      enforceSafetyStops();
      break;
    }
    case "email.complained":
      logEvent(row?.lead_id ?? null, "email", "complaint", to);
      optOut({ leadId: row?.lead_id, email: to, channel: "email", reason: "Marked as spam" });
      enforceSafetyStops();
      break;
    default:
      break;
  }
  return new Response("ok");
}
