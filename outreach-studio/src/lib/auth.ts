// Single-user password login. The session cookie is an HMAC of a fixed string with APP_SECRET,
// computed with Web Crypto so it also works in middleware (edge runtime).
export const SESSION_COOKIE = "fos_session";

export async function sessionToken(secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("fise-outreach-studio-session-v1"));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const PUBLIC_PATHS = [/^\/login/, /^\/api\/login/, /^\/u\//, /^\/api\/unsub\//, /^\/i\//, /^\/p\//, /^\/api\/webhooks\//, /^\/bot$/, /^\/_next\//, /^\/favicon/];
