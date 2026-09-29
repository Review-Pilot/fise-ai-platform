// Website platform detection + whether a Fise script snippet can be embedded.

export interface PlatformResult {
  platform: string;
  evidence: string[];
  canInstall: "yes" | "likely" | "no";
  canInstallReason: string;
}

interface Signature {
  platform: string;
  patterns: RegExp[];
  canInstall: "yes" | "likely" | "no";
  reason: string;
}

const SIGNATURES: Signature[] = [
  {
    platform: "WordPress",
    patterns: [/wp-content\//i, /wp-includes\//i, /<meta[^>]+generator[^>]+WordPress/i, /wp-json/i],
    canInstall: "yes",
    reason: "WordPress: paste the snippet via a header/footer plugin or the theme.",
  },
  {
    platform: "Wix",
    patterns: [/static\.wixstatic\.com/i, /static\.parastorage\.com/i, /<meta[^>]+generator[^>]+Wix/i, /wix-code/i],
    canInstall: "likely",
    reason: "Wix: Custom Code needs a premium plan with a connected domain.",
  },
  {
    platform: "Shopify",
    patterns: [/cdn\.shopify\.com/i, /Shopify\.theme/i, /myshopify\.com/i],
    canInstall: "yes",
    reason: "Shopify: add the snippet to theme.liquid or via an app embed.",
  },
  {
    platform: "Squarespace",
    patterns: [/static1\.squarespace\.com/i, /squarespace-cdn\.com/i, /<!-- This is Squarespace/i],
    canInstall: "likely",
    reason: "Squarespace: Code Injection needs a Business plan or higher.",
  },
  {
    platform: "Webflow",
    patterns: [/data-wf-page/i, /website-files\.com/i, /webflow\.js/i, /<meta[^>]+generator[^>]+Webflow/i],
    canInstall: "yes",
    reason: "Webflow: add the snippet in Project Settings → Custom Code.",
  },
  {
    platform: "Duda",
    patterns: [/multiscreensite\.com/i, /dudamobile/i, /irp\.cdn-website\.com/i],
    canInstall: "yes",
    reason: "Duda: add the snippet in Site Settings → Head HTML.",
  },
  {
    platform: "GoDaddy Website Builder",
    patterns: [/img1\.wsimg\.com/i, /<meta[^>]+generator[^>]+Starfield/i, /godaddy website builder/i],
    canInstall: "likely",
    reason: "GoDaddy builder: HTML sections are allowed, but some plans restrict site-wide scripts.",
  },
  {
    platform: "Weebly",
    patterns: [/weebly\.com/i, /editmysite\.com/i],
    canInstall: "likely",
    reason: "Weebly/Square Online: header code needs a paid plan.",
  },
  {
    platform: "Jimdo",
    patterns: [/jimdo/i, /jimcdn\.com/i],
    canInstall: "likely",
    reason: "Jimdo: head HTML is available on paid plans.",
  },
  {
    platform: "Joomla",
    patterns: [/<meta[^>]+generator[^>]+Joomla/i, /\/media\/jui\//i],
    canInstall: "yes",
    reason: "Joomla: add the snippet in the template.",
  },
  {
    platform: "Drupal",
    patterns: [/<meta[^>]+generator[^>]+Drupal/i, /\/sites\/default\/files/i, /drupal-settings-json/i],
    canInstall: "yes",
    reason: "Drupal: add the snippet in the theme or a block.",
  },
  {
    platform: "Framer",
    patterns: [/framerusercontent\.com/i, /<meta[^>]+generator[^>]+Framer/i],
    canInstall: "likely",
    reason: "Framer: custom code needs a paid site plan.",
  },
  {
    platform: "Carrd",
    patterns: [/carrd\.co/i],
    canInstall: "likely",
    reason: "Carrd: embeds need Carrd Pro.",
  },
  {
    platform: "Google Sites",
    patterns: [/sites\.google\.com/i, /<meta[^>]+generator[^>]+Google Sites/i],
    canInstall: "no",
    reason: "Google Sites sandboxes embeds in iframes — a site-wide chat widget can't be installed.",
  },
];

/** Hostnames that mean "free subdomain on a builder" — the owner can't add scripts on free plans. */
const FREE_SUBDOMAIN: { re: RegExp; reason: string }[] = [
  { re: /\.wixsite\.com$/i, reason: "Free Wix subdomain — custom code needs a premium plan and own domain." },
  { re: /\.wordpress\.com$/i, reason: "WordPress.com hosted site — plugins/scripts need a Business plan." },
  { re: /\.webflow\.io$/i, reason: "Webflow staging domain — no paid site plan." },
  { re: /\.weebly\.com$/i, reason: "Free Weebly subdomain." },
  { re: /\.business\.site$/i, reason: "Google Business Profile website — scripts not supported." },
  { re: /\.godaddysites\.com$/i, reason: "GoDaddy free builder subdomain." },
];

export function detectPlatform(html: string, finalUrl: string, headers: Record<string, string> = {}): PlatformResult {
  const host = (() => {
    try {
      return new URL(finalUrl).hostname;
    } catch {
      return "";
    }
  })();
  const headerBlob = Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  for (const sig of SIGNATURES) {
    const hits = sig.patterns.filter((p) => p.test(html) || p.test(headerBlob));
    if (hits.length) {
      const free = FREE_SUBDOMAIN.find((f) => f.re.test(host));
      return {
        platform: sig.platform,
        evidence: hits.map((h) => h.source),
        canInstall: free ? "no" : sig.canInstall,
        canInstallReason: free ? free.reason : sig.reason,
      };
    }
  }
  if (/x-powered-by: (next\.js|express|php|asp\.net)/i.test(headerBlob) || /__NEXT_DATA__|_next\/static/i.test(html)) {
    return {
      platform: "Custom (framework)",
      evidence: ["framework markers"],
      canInstall: "yes",
      canInstallReason: "Custom-built site: a developer can paste one script tag before </body>.",
    };
  }
  return {
    platform: "Custom HTML",
    evidence: [],
    canInstall: "yes",
    canInstallReason: "Custom site: a developer can paste one script tag before </body>.",
  };
}

/** Social/link-in-bio URLs are not websites. */
export function isSocialOnlyUrl(url: string): boolean {
  return /(^|\.)(facebook\.com|fb\.me|instagram\.com|linktr\.ee|linkin\.bio|wa\.me|api\.whatsapp\.com|tiktok\.com|x\.com|twitter\.com|linkedin\.com|youtube\.com|google\.com|goo\.gl|g\.page)$/i.test(
    (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return "";
      }
    })(),
  );
}

const PARKED_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /(this|the) domain (name )?(is|may be) for sale/i, reason: "Domain for sale page" },
  { re: /buy this domain/i, reason: "Domain for sale page" },
  { re: /(sedoparking|parkingcrew|bodis\.com|above\.com\/marketplace|hugedomains|dan\.com\/buy|afternic)/i, reason: "Parked domain service" },
  { re: /domain (has been )?(registered|parked) (at|with|by)/i, reason: "Registrar parking page" },
  { re: /(account (has been )?suspended|this account is suspended)/i, reason: "Hosting account suspended" },
  { re: /(future home of|website coming soon|site is under construction|we'?re launching soon)/i, reason: "Coming soon / under construction" },
  { re: /(apache2 (ubuntu|debian) default page|welcome to nginx!|it works!<\/h1>|iis windows server|cpanel default|default web site page)/i, reason: "Default server page" },
  { re: /<title>index of \//i, reason: "Directory listing, no site" },
];

export function detectParked(html: string, visibleText: string, wordCount: number): { parked: boolean; reason?: string } {
  for (const p of PARKED_PATTERNS) if (p.re.test(html)) return { parked: true, reason: p.reason };
  if (wordCount < 25 && !/<script/i.test(html)) return { parked: true, reason: "Almost no content on the homepage" };
  if (wordCount < 8) return { parked: true, reason: "Homepage has no readable content" };
  void visibleText;
  return { parked: false };
}
