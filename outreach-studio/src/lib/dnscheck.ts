// Checks SPF, DKIM and DMARC for the sending subdomain before the first send.
import dns from "node:dns/promises";
import { Resend } from "resend";
import { config } from "./config";
import { updateSettings } from "./settings";

export interface DnsResult {
  ok: boolean;
  domain: string;
  items: { id: string; label: string; ok: boolean; detail: string; fix?: string }[];
}

async function txt(name: string): Promise<string[]> {
  try {
    return (await dns.resolveTxt(name)).map((r) => r.join(""));
  } catch {
    return [];
  }
}

/** Organisational domain (good enough for .co.za / .com style domains). */
export function orgDomain(domain: string): string {
  const parts = domain.split(".");
  const twoLevelTld = /^(co|org|net|gov|ac|web)\.[a-z]{2}$/.test(parts.slice(-2).join("."));
  return parts.slice(twoLevelTld ? -3 : -2).join(".");
}

export async function checkDns(): Promise<DnsResult> {
  const domain = config.sendingDomain.toLowerCase();
  const items: DnsResult["items"] = [];
  if (!domain) {
    return {
      ok: false,
      domain: "",
      items: [{ id: "domain", label: "Sending domain configured", ok: false, detail: "SENDING_DOMAIN is not set", fix: "Set SENDING_DOMAIN=mail.yourdomain.co.za in .env" }],
    };
  }
  const org = orgDomain(domain);
  items.push({
    id: "subdomain",
    label: "Uses a separate sending subdomain",
    ok: domain !== org,
    detail: domain === org ? `${domain} is your main domain` : `${domain} (main domain ${org} stays protected)`,
    fix: domain === org ? `Use a subdomain such as mail.${org} so outreach can't hurt your main domain's reputation.` : undefined,
  });
  const fromDomain = config.fromEmail.match(/@([^>\s]+)/)?.[1]?.toLowerCase() ?? "";
  items.push({
    id: "from",
    label: "From address uses the sending subdomain",
    ok: fromDomain === domain,
    detail: config.fromEmail || "FROM_EMAIL not set",
    fix: fromDomain === domain ? undefined : `Set FROM_EMAIL="Your Name <you@${domain}>"`,
  });

  // SPF: Resend publishes it on send.<domain> (return path); some setups put it on the domain itself.
  const spfRecords = [...(await txt(`send.${domain}`)), ...(await txt(domain))].filter((r) => r.startsWith("v=spf1"));
  const spfOk = spfRecords.some((r) => /include:(amazonses\.com|_spf\.resend\.com|spf\.resend\.com)/.test(r) || / include:/.test(r));
  items.push({
    id: "spf",
    label: "SPF record",
    ok: spfOk,
    detail: spfRecords[0] ?? "No SPF record found",
    fix: spfOk ? undefined : `Add the SPF TXT record Resend shows for ${domain} (usually on send.${domain}: "v=spf1 include:amazonses.com ~all").`,
  });

  const dkimName = `${config.dkimSelector}._domainkey.${domain}`;
  const dkim = (await txt(dkimName)).find((r) => /p=/.test(r));
  items.push({
    id: "dkim",
    label: "DKIM record",
    ok: Boolean(dkim),
    detail: dkim ? `${dkimName} found` : `No DKIM key at ${dkimName}`,
    fix: dkim ? undefined : `Add the DKIM TXT record Resend shows (name ${dkimName}).`,
  });

  const dmarc = [...(await txt(`_dmarc.${domain}`)), ...(await txt(`_dmarc.${org}`))].find((r) => r.startsWith("v=DMARC1"));
  items.push({
    id: "dmarc",
    label: "DMARC record",
    ok: Boolean(dmarc),
    detail: dmarc ?? "No DMARC record found",
    fix: dmarc ? undefined : `Add TXT _dmarc.${org} = "v=DMARC1; p=none; rua=mailto:dmarc@${org}" (tighten to p=quarantine once reports look clean).`,
  });

  if (config.resendKey) {
    try {
      const resend = new Resend(config.resendKey);
      const { data } = await resend.domains.list();
      const list = (data as unknown as { data?: { name: string; status: string }[] })?.data ?? [];
      const d = list.find((x) => x.name === domain);
      items.push({
        id: "resend",
        label: "Domain verified in Resend",
        ok: d?.status === "verified",
        detail: d ? `Resend status: ${d.status}` : `${domain} is not added in Resend`,
        fix: d?.status === "verified" ? undefined : "Add the domain in Resend → Domains and verify it.",
      });
    } catch (e) {
      items.push({ id: "resend", label: "Domain verified in Resend", ok: false, detail: `Could not reach Resend: ${(e as Error).message}` });
    }
  } else {
    items.push({ id: "resend", label: "Resend API key", ok: false, detail: "RESEND_API_KEY is not set" });
  }

  const ok = items.every((i) => i.ok);
  if (ok) updateSettings("sending", { dnsVerifiedAt: new Date().toISOString() });
  return { ok, domain, items };
}
