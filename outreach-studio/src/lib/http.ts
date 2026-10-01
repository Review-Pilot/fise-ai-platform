// Polite crawler fetch: identifies itself, respects robots.txt, rate-limits per host,
// caps response size, and refuses private/internal addresses (SSRF protection).
import dns from "node:dns/promises";
import net from "node:net";
import robotsParser from "robots-parser";
import { config } from "./config";

export const USER_AGENT_TOKEN = "FiseOutreachBot";

export function userAgent() {
  return `Mozilla/5.0 (compatible; ${USER_AGENT_TOKEN}/1.0; +${config.publicBaseUrl}/bot)`;
}

const MIN_INTERVAL_MS = 1500;
const MAX_BYTES = 2_500_000;
const lastHit = new Map<string, number>();
const robotsCache = new Map<string, { robots: ReturnType<typeof robotsParser> | null; at: number }>();

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:127.");
}

export async function assertPublicHost(hostname: string) {
  if (process.env.ALLOW_PRIVATE_FETCH === "1") return; // tests only
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error(`Refusing to fetch private address ${hostname}`);
    return;
  }
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(hostname)) throw new Error(`Refusing to fetch ${hostname}`);
  try {
    const addrs = await dns.lookup(hostname, { all: true });
    if (addrs.some((a) => isPrivateIp(a.address))) throw new Error(`${hostname} resolves to a private address`);
  } catch (e) {
    if (e instanceof Error && /private/.test(e.message)) throw e;
    // DNS failure (e.g. behind a proxy that resolves for us) — let fetch report the real error.
  }
}

async function waitForHost(host: string) {
  const last = lastHit.get(host) ?? 0;
  const wait = last + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(host, Date.now());
}

async function getRobots(origin: string) {
  const cached = robotsCache.get(origin);
  if (cached && Date.now() - cached.at < 3600_000) return cached.robots;
  let robots: ReturnType<typeof robotsParser> | null = null;
  try {
    const res = await rawFetch(`${origin}/robots.txt`, 8000);
    if (res.ok) robots = robotsParser(`${origin}/robots.txt`, res.body.slice(0, 200_000));
  } catch {
    robots = null; // No robots.txt reachable → allowed.
  }
  robotsCache.set(origin, { robots, at: Date.now() });
  return robots;
}

export async function robotsAllows(url: string): Promise<boolean> {
  const u = new URL(url);
  const robots = await getRobots(u.origin);
  if (!robots) return true;
  return robots.isAllowed(url, USER_AGENT_TOKEN) !== false;
}

export interface FetchResult {
  url: string;
  finalUrl: string;
  status: number;
  ok: boolean;
  contentType: string;
  body: string;
  headers: Record<string, string>;
}

async function rawFetch(url: string, timeoutMs: number): Promise<FetchResult> {
  const u = new URL(url);
  await assertPublicHost(u.hostname);
  await waitForHost(u.hostname);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "user-agent": userAgent(),
        accept: "text/html,application/xhtml+xml,text/css,*/*;q=0.8",
        "accept-language": "en-ZA,en;q=0.9",
      },
    });
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BYTES) {
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
    }
    const body = new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k] = v));
    return {
      url,
      finalUrl: res.url || url,
      status: res.status,
      ok: res.ok,
      contentType: res.headers.get("content-type") ?? "",
      body,
      headers,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch a page as a well-behaved crawler. Throws RobotsBlockedError if disallowed. */
export class RobotsBlockedError extends Error {}

export async function politeFetch(url: string, timeoutMs = 15000): Promise<FetchResult> {
  if (!(await robotsAllows(url))) throw new RobotsBlockedError(`robots.txt disallows ${url}`);
  return rawFetch(url, timeoutMs);
}

export async function fetchBinary(url: string, maxBytes = 3_000_000): Promise<{ buf: Buffer; type: string } | null> {
  try {
    const u = new URL(url);
    await assertPublicHost(u.hostname);
    await waitForHost(u.hostname);
    const res = await fetch(url, { headers: { "user-agent": userAgent() }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    if (ab.byteLength > maxBytes) return null;
    return { buf: Buffer.from(ab), type: res.headers.get("content-type") ?? "" };
  } catch {
    return null;
  }
}
