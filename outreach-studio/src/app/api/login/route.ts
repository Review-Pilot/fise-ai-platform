import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { SESSION_COOKIE, sessionToken } from "@/lib/auth";
import { config } from "@/lib/config";

export async function POST(req: Request) {
  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "/") || "/";
  const expected = Buffer.from(config.appPassword);
  const given = Buffer.from(password);
  const ok = expected.length > 0 && expected.length === given.length && timingSafeEqual(expected, given);
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  if (!ok) return NextResponse.redirect(new URL(`/login?error=1&next=${encodeURIComponent(safeNext)}`, req.url), 303);
  const res = NextResponse.redirect(new URL(safeNext, req.url), 303);
  res.cookies.set(SESSION_COOKIE, await sessionToken(config.appSecret), {
    httpOnly: true,
    sameSite: "lax",
    secure: config.publicBaseUrl.startsWith("https"),
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
