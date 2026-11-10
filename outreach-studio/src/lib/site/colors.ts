// Collects brand colour candidates from HTML, stylesheets and the logo.
import type { CheerioAPI } from "cheerio";
import sharp from "sharp";
import { parseColor, type ColorCandidate, type RGB } from "../color";
import { fetchBinary } from "../http";

const COLOR_RE = /#[0-9a-f]{3,8}\b|rgba?\([^)]{5,40}\)|hsla?\([^)]{5,40}\)/gi;
const BRAND_VAR = /--[\w-]*(primary|brand|accent|main|theme|secondary|highlight|cta|button)[\w-]*\s*:\s*([^;}{]+)/gi;
const KEY_SELECTOR = /(^|[\s,.#>])(button|\.btn|\.button|\.cta|header|\.header|nav|\.navbar|a:hover|a\b|\.wp-block-button__link|\.elementor-button|h1|h2|\.site-title|\.logo|footer)/i;

export function candidatesFromCss(css: string, sourceLabel: string): ColorCandidate[] {
  const out: ColorCandidate[] = [];
  for (const m of css.matchAll(BRAND_VAR)) {
    const c = parseColor(m[2].trim());
    if (c) out.push({ color: c, weight: /primary|brand|main|theme/i.test(m[1]) ? 10 : 6, source: `CSS variable ${m[0].split(":")[0].trim()}` });
  }
  // Rules targeting buttons / header / links weigh more than a random colour.
  for (const rule of css.matchAll(/([^{}]{1,300})\{([^{}]{1,2000})\}/g)) {
    const selector = rule[1];
    const body = rule[2];
    const key = KEY_SELECTOR.test(selector);
    for (const decl of body.matchAll(/(background(?:-color)?|color|border(?:-color)?|fill)\s*:\s*([^;]+)/gi)) {
      for (const cm of decl[2].matchAll(COLOR_RE)) {
        const c = parseColor(cm[0]);
        if (!c) continue;
        const isBg = /background/i.test(decl[1]);
        out.push({
          color: c,
          weight: key ? (isBg ? 4 : 2.5) : isBg ? 1 : 0.5,
          source: key ? `${selector.trim().slice(0, 40)} ${decl[1]}` : sourceLabel,
        });
      }
    }
  }
  return out;
}

export function candidatesFromHtml($: CheerioAPI): ColorCandidate[] {
  const out: ColorCandidate[] = [];
  const theme = $("meta[name='theme-color']").attr("content");
  const themeRgb = theme ? parseColor(theme) : null;
  if (themeRgb) out.push({ color: themeRgb, weight: 12, source: "meta theme-color" });
  const tile = $("meta[name='msapplication-TileColor']").attr("content");
  const tileRgb = tile ? parseColor(tile) : null;
  if (tileRgb) out.push({ color: tileRgb, weight: 6, source: "msapplication-TileColor" });
  $("[style]").each((_, el) => {
    const tag = (el as { tagName?: string }).tagName ?? "";
    const style = $(el).attr("style") ?? "";
    const key = /^(a|button|header|nav|h1|h2)$/i.test(tag) || /btn|button|cta/i.test($(el).attr("class") ?? "");
    for (const m of style.matchAll(COLOR_RE)) {
      const c = parseColor(m[0]);
      if (c) out.push({ color: c, weight: key ? 3 : 0.7, source: key ? `inline style on <${tag}>` : "inline styles" });
    }
  });
  return out;
}

/** Dominant non-neutral colours of the logo image. */
export async function candidatesFromLogo(logoUrl: string): Promise<ColorCandidate[]> {
  const img = await fetchBinary(logoUrl, 2_000_000);
  if (!img) return [];
  try {
    const { data, info } = await sharp(img.buf, { density: 96 })
      .resize(48, 48, { fit: "inside" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const buckets = new Map<string, { rgb: RGB; n: number }>();
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i + 3] < 200) continue;
      const rgb: RGB = [data[i], data[i + 1], data[i + 2]];
      const key = rgb.map((v) => v >> 4).join(",");
      const b = buckets.get(key);
      if (b) b.n++;
      else buckets.set(key, { rgb, n: 1 });
    }
    const total = [...buckets.values()].reduce((s, b) => s + b.n, 0) || 1;
    return [...buckets.values()]
      .sort((a, b) => b.n - a.n)
      .slice(0, 6)
      .map((b) => ({ color: b.rgb, weight: 8 * (b.n / total) + 1, source: "logo" }));
  } catch {
    return [];
  }
}
