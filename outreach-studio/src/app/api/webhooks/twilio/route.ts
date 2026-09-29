// Inbound SMS: STOP / UNSUBSCRIBE / QUIT etc. adds the number to the global do-not-contact list.
import { config } from "@/lib/config";
import { verifyTwilio } from "@/lib/sms";
import { optOut } from "@/lib/optout";
import { db } from "@/lib/db";
import { normalisePhone } from "@/lib/dnc";

export async function POST(req: Request) {
  const form = await req.formData();
  const params = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const url = `${config.publicBaseUrl}/api/webhooks/twilio`;
  if (!verifyTwilio(url, params, req.headers.get("x-twilio-signature") ?? "", config.twilio.authToken)) {
    return new Response("Invalid signature", { status: 401 });
  }
  const from = normalisePhone(params.From ?? "");
  if (from && /^\s*(stop|stopall|unsubscribe|cancel|end|quit|opt ?out|remove)\b/i.test(params.Body ?? "")) {
    const lead = db().prepare("SELECT lead_id FROM sms WHERE phone = ? ORDER BY created_at DESC LIMIT 1").get(from) as { lead_id: string } | undefined;
    optOut({ leadId: lead?.lead_id, phone: from, channel: "sms", reason: "Replied STOP" });
  }
  return new Response("<Response></Response>", { headers: { "content-type": "text/xml" } });
}
