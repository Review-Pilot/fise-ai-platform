import { ok, bad, route } from "@/lib/api";
import { approveBatch, cancelBatch, getBatch, removeFromBatch } from "@/lib/batches";

export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const batch = getBatch(id);
  if (!batch) return bad("Batch not found", 404);
  const b = await req.json();
  if (b.action === "approve") {
    if (b.confirm !== true) return bad("Confirm the approval");
    const r = approveBatch(id);
    return ok({ ...r, message: `${r.queued} queued${r.skipped.length ? `, ${r.skipped.length} skipped` : ""}` });
  }
  if (b.action === "cancel") {
    cancelBatch(id);
    return ok({ message: "Batch cancelled" });
  }
  if (b.action === "remove" && b.itemId) {
    removeFromBatch(batch.type, b.itemId);
    return ok({ message: "Removed" });
  }
  return bad("Unknown action");
});
