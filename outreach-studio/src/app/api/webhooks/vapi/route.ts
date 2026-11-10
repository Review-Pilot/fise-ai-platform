// Vapi server messages. Only the end-of-call report is needed to record outcomes.
import { timingSafeEqual } from "node:crypto";
import { config } from "@/lib/config";
import { handleEndOfCall } from "@/lib/calls";
import { db } from "@/lib/db";

function authorised(req: Request): boolean {
  const secret = config.vapi.webhookSecret;
  if (!secret) return process.env.NODE_ENV !== "production";
  const given = req.headers.get("x-vapi-secret") ?? "";
  return given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
}

export async function POST(req: Request) {
  if (!authorised(req)) return new Response("Unauthorised", { status: 401 });
  const body = (await req.json()) as { message?: Record<string, unknown> };
  const m = (body.message ?? {}) as {
    type?: string;
    status?: string;
    endedReason?: string;
    call?: { id?: string; assistantOverrides?: { metadata?: { fiseCallId?: string } }; metadata?: { fiseCallId?: string } };
    transcript?: string;
    recordingUrl?: string;
    artifact?: { transcript?: string; recordingUrl?: string; recording?: { url?: string } };
    analysis?: { summary?: string; structuredData?: { outcome?: string } };
  };
  if (m.type === "status-update" && m.call?.id && m.status === "in-progress") {
    db().prepare("UPDATE calls SET status = 'in_progress' WHERE vapi_call_id = ?").run(m.call.id);
  }
  if (m.type === "end-of-call-report" && m.call?.id) {
    await handleEndOfCall({
      vapiCallId: m.call.id,
      fiseCallId: m.call.assistantOverrides?.metadata?.fiseCallId ?? m.call.metadata?.fiseCallId,
      endedReason: m.endedReason,
      transcript: m.artifact?.transcript ?? m.transcript,
      recordingUrl: m.artifact?.recordingUrl ?? m.artifact?.recording?.url ?? m.recordingUrl,
      summary: m.analysis?.summary,
      structuredOutcome: m.analysis?.structuredData?.outcome,
    });
  }
  return Response.json({ ok: true });
}
