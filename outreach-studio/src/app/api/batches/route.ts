import { ok, bad, route } from "@/lib/api";
import { addEmailsToBatch } from "@/lib/batches";

export const POST = route(async (req: Request) => {
  const b = await req.json();
  if (b.type !== "email" || !Array.isArray(b.emailIds)) return bad("Expected { type: 'email', emailIds: [] }");
  const r = addEmailsToBatch(b.emailIds);
  if (!r.batchId) return bad(`Nothing added: ${r.skipped.map((s) => s.reason).join("; ")}`);
  return ok(r);
});
