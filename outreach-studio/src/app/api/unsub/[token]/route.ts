// RFC 8058 one-click unsubscribe target (List-Unsubscribe + List-Unsubscribe-Post headers).
import { NextResponse } from "next/server";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe";
import { optOut } from "@/lib/optout";

export async function POST(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const v = verifyUnsubscribeToken(token);
  if (!v) return new Response("Invalid link", { status: 400 });
  optOut({ leadId: v.leadId, email: v.email, channel: "email", reason: "Unsubscribed (one-click)" });
  return new Response("You have been unsubscribed.", { status: 200 });
}

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  return NextResponse.redirect(new URL(`/u/${token}`, req.url));
}
