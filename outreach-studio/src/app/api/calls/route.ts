import { ok, bad, route } from "@/lib/api";
import { createTestCall, placeCall, getCall } from "@/lib/calls";

export const POST = route(async (req: Request) => {
  const b = await req.json();
  if (b.action !== "test") return bad("Unknown action");
  const id = await createTestCall(b.leadId || null);
  const r = await placeCall(id);
  const call = getCall(id)!;
  if (r.status !== "started") return bad(call.error ?? `Call ${r.status}`);
  return ok({ message: `Calling ${call.phone} now…`, callId: id });
});
