// Stateless, signed unsubscribe tokens (no database lookup needed to verify).
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config";

function sign(payload: string) {
  return createHmac("sha256", config.appSecret).update(`unsub:${payload}`).digest("base64url").slice(0, 22);
}

export function unsubscribeToken(email: string, leadId: string | null): string {
  const payload = Buffer.from(JSON.stringify({ e: email.toLowerCase(), l: leadId })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyUnsubscribeToken(token: string): { email: string; leadId: string | null } | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const { e, l } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof e === "string" ? { email: e, leadId: l ?? null } : null;
  } catch {
    return null;
  }
}

export function unsubscribeUrls(email: string, leadId: string | null) {
  const token = unsubscribeToken(email, leadId);
  return {
    page: `${config.publicBaseUrl}/u/${token}`,
    oneClick: `${config.publicBaseUrl}/api/unsub/${token}`,
  };
}
