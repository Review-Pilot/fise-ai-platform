// Colour parsing, WCAG contrast and palette picking.
import type { BrandColors } from "./types";

export type RGB = [number, number, number];

const NAMED: Record<string, string> = {
  red: "#ff0000", blue: "#0000ff", green: "#008000", orange: "#ffa500", purple: "#800080", navy: "#000080",
  teal: "#008080", maroon: "#800000", crimson: "#dc143c", gold: "#ffd700", tomato: "#ff6347", royalblue: "#4169e1",
  darkblue: "#00008b", darkgreen: "#006400", darkred: "#8b0000", orangered: "#ff4500", dodgerblue: "#1e90ff",
};

export function parseColor(input: string): RGB | null {
  const s = input.trim().toLowerCase();
  if (NAMED[s]) return parseColor(NAMED[s]);
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split("").map((c) => c + c).join("");
    if (h.length === 8) {
      if (parseInt(h.slice(6, 8), 16) < 200) return null; // mostly transparent
      h = h.slice(0, 6);
    }
    if (h.length !== 6) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  m = s.match(/^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    if (m[4] !== undefined) {
      const a = m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      if (a < 0.8) return null;
    }
    return [Number(m[1]), Number(m[2]), Number(m[3])].map((v) => Math.max(0, Math.min(255, Math.round(v)))) as RGB;
  }
  m = s.match(/^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    if (m[4] !== undefined) {
      const a = m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      if (a < 0.8) return null;
    }
    return hslToRgb(Number(m[1]), Number(m[2]) / 100, Number(m[3]) / 100);
  }
  return null;
}

export function toHex([r, g, b]: RGB): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

export function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h * 60, s, l];
}

export function hslToRgb(h: number, s: number, l: number): RGB {
  const hn = (((h % 360) + 360) % 360) / 360;
  if (s === 0) return [l * 255, l * 255, l * 255].map(Math.round) as RGB;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(hn + 1 / 3), f(hn), f(hn - 1 / 3)].map((v) => Math.round(v * 255)) as RGB;
}

export function luminance([r, g, b]: RGB): number {
  const c = [r, g, b].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrast(a: string | RGB, b: string | RGB): number {
  const ra = typeof a === "string" ? parseColor(a)! : a;
  const rb = typeof b === "string" ? parseColor(b)! : b;
  const la = luminance(ra), lb = luminance(rb);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export const WHITE = "#ffffff";
export const INK = "#111827";

/**
 * Returns a background colour (lightness-adjusted if needed) and the text colour to use on it
 * so the pair meets WCAG AA for normal text (4.5:1).
 */
export function ensureContrast(hex: string, min = 4.5): { bg: string; fg: string; adjusted: boolean } {
  const rgb = parseColor(hex) ?? parseColor("#1769e0")!;
  const base = toHex(rgb);
  if (contrast(base, WHITE) >= min) return { bg: base, fg: WHITE, adjusted: false };
  if (contrast(base, INK) >= min) return { bg: base, fg: INK, adjusted: false };
  // Neither passes: darken until white text passes (keeps the brand hue).
  const [h, s, l] = rgbToHsl(rgb);
  for (let nl = l; nl >= 0; nl -= 0.02) {
    const candidate = toHex(hslToRgb(h, s, nl));
    if (contrast(candidate, WHITE) >= min) return { bg: candidate, fg: WHITE, adjusted: true };
  }
  return { bg: "#1f2937", fg: WHITE, adjusted: true };
}

/** A colour used as text on white (links, headings) must itself reach 4.5:1 against white. */
export function ensureReadableOnWhite(hex: string, min = 4.5): string {
  const rgb = parseColor(hex);
  if (!rgb) return INK;
  if (contrast(rgb, WHITE) >= min) return toHex(rgb);
  const [h, s, l] = rgbToHsl(rgb);
  for (let nl = l; nl >= 0; nl -= 0.02) {
    const c = toHex(hslToRgb(h, s, nl));
    if (contrast(c, WHITE) >= min) return c;
  }
  return INK;
}

export function isNeutral(rgb: RGB): boolean {
  const [, s, l] = rgbToHsl(rgb);
  return s < 0.15 || l > 0.94 || l < 0.07;
}

function distance(a: RGB, b: RGB): number {
  // Weighted RGB distance ("redmean") — cheap and good enough for clustering brand colours.
  const rm = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

function hueDiff(a: RGB, b: RGB): number {
  const d = Math.abs(rgbToHsl(a)[0] - rgbToHsl(b)[0]);
  return Math.min(d, 360 - d);
}

export interface ColorCandidate {
  color: RGB;
  weight: number;
  source: string;
}

export function clusterCandidates(cands: ColorCandidate[]): ColorCandidate[] {
  const clusters: ColorCandidate[] = [];
  for (const c of cands.sort((a, b) => b.weight - a.weight)) {
    const near = clusters.find((k) => distance(k.color, c.color) < 60);
    if (near) {
      near.weight += c.weight;
      if (!near.source.includes(c.source)) near.source += `, ${c.source}`;
    } else clusters.push({ ...c });
  }
  return clusters.sort((a, b) => b.weight - a.weight);
}

export function fallbackColors(defaults: { primary: string; secondary: string; accent: string }): BrandColors {
  return finalisePalette(defaults.primary, defaults.secondary, defaults.accent, "default", ["Using neutral Fise palette"]);
}

export function finalisePalette(
  primary: string,
  secondary: string,
  accent: string,
  source: BrandColors["source"],
  notes: string[] = [],
): BrandColors {
  const p = ensureContrast(primary);
  const s = ensureContrast(secondary);
  const a = ensureContrast(accent);
  if (p.adjusted) notes.push(`Primary darkened from ${primary} to ${p.bg} for AA contrast`);
  if (s.adjusted) notes.push(`Secondary darkened from ${secondary} to ${s.bg} for AA contrast`);
  if (a.adjusted) notes.push(`Accent darkened from ${accent} to ${a.bg} for AA contrast`);
  return { primary: p.bg, secondary: s.bg, accent: a.bg, onPrimary: p.fg, onSecondary: s.fg, onAccent: a.fg, source, notes };
}

/** Picks primary / secondary / accent from weighted candidates. */
export function pickPalette(cands: ColorCandidate[], defaults: { primary: string; secondary: string; accent: string }): BrandColors {
  const brand = clusterCandidates(cands.filter((c) => !isNeutral(c.color)));
  if (!brand.length) {
    // Site is monochrome: use its darkest strong colour as primary if any, else defaults.
    const darks = clusterCandidates(cands.filter((c) => rgbToHsl(c.color)[2] < 0.3));
    if (darks.length) {
      return finalisePalette(toHex(darks[0].color), defaults.secondary, defaults.accent, "site", [
        `Site is mostly neutral; primary from ${darks[0].source}`,
      ]);
    }
    return fallbackColors(defaults);
  }
  const primary = brand[0];
  const secondary =
    brand.slice(1).find((c) => hueDiff(c.color, primary.color) > 25 || Math.abs(rgbToHsl(c.color)[2] - rgbToHsl(primary.color)[2]) > 0.25) ??
    null;
  const accent =
    brand.slice(1).find((c) => c !== secondary && hueDiff(c.color, primary.color) > 40) ?? null;

  const [h, s, l] = rgbToHsl(primary.color);
  const secondaryHex = secondary ? toHex(secondary.color) : toHex(hslToRgb(h, Math.min(1, s * 0.9), Math.max(0.15, l - 0.25)));
  const accentHex = accent ? toHex(accent.color) : toHex(hslToRgb(h + 150, Math.max(0.5, s), 0.42));
  const notes = [`Primary from ${primary.source}`];
  if (secondary) notes.push(`Secondary from ${secondary.source}`);
  else notes.push("Secondary derived (darker shade of primary)");
  if (accent) notes.push(`Accent from ${accent.source}`);
  else notes.push("Accent derived (complementary hue)");
  return finalisePalette(toHex(primary.color), secondaryHex, accentHex, "site", notes);
}
