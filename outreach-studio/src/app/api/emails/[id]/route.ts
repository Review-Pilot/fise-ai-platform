import { ok, bad, route } from "@/lib/api";
import { getEmail, saveEdits, generateEmail, renderEmail } from "@/lib/email/build";
import { updateLead } from "@/lib/leads";
import { finalisePalette, parseColor } from "@/lib/color";
import { validateCopy } from "@/lib/email/rules";

export const maxDuration = 120;
type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, ctx: Ctx) => {
  const email = getEmail((await ctx.params).id);
  return email ? ok({ email }) : bad("Not found", 404);
});

export const PATCH = route(async (req: Request, ctx: Ctx) => {
  const id = (await ctx.params).id;
  const email = getEmail(id);
  if (!email) return bad("Not found", 404);
  const b = await req.json();
  let regenerateImage = Boolean(b.regenerateImage);
  if (b.colors) {
    const { primary, secondary, accent } = b.colors;
    if (![primary, secondary, accent].every((c: unknown) => typeof c === "string" && parseColor(c))) return bad("Invalid colour");
    updateLead(email.lead_id, { colors: finalisePalette(primary, secondary, accent, "manual", ["Set in the editor"]) });
    regenerateImage = true;
  }
  const saved = await saveEdits(id, b.copy ?? {}, regenerateImage);
  return ok({ email: saved, issues: saved.kind === "initial" ? validateCopy(saved.copy) : [] });
});

/** Regenerate copy with Claude (keeps the same draft). */
export const POST = route(async (req: Request, ctx: Ctx) => {
  const id = (await ctx.params).id;
  const email = getEmail(id);
  if (!email) return bad("Not found", 404);
  const { action } = await req.json();
  if (action === "regenerate") {
    if (email.status !== "draft") return bad("Only drafts can be regenerated");
    const r = await generateEmail(email.lead_id, id);
    return ok({ email: r.email, issues: r.issues, source: r.source });
  }
  if (action === "rerender") return ok({ email: await renderEmail(id, { regenerateImage: true }) });
  return bad("Unknown action");
});
