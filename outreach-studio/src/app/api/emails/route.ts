import { ok, bad, route } from "@/lib/api";
import { generateEmail } from "@/lib/email/build";
import { getLead } from "@/lib/leads";

export const maxDuration = 120;

export const POST = route(async (req: Request) => {
  const { leadId } = await req.json();
  if (!getLead(leadId)) return bad("Lead not found", 404);
  const r = await generateEmail(leadId);
  return ok({ email: r.email, issues: r.issues, source: r.source });
});
