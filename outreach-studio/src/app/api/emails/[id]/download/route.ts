import { getEmail } from "@/lib/email/build";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const email = getEmail((await ctx.params).id);
  if (!email) return new Response("Not found", { status: 404 });
  const name = (email.subject || "email").replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 50);
  return new Response(email.html, {
    headers: { "content-type": "text/html; charset=utf-8", "content-disposition": `attachment; filename="${name}.html"` },
  });
}
