import { describe, it, expect } from "vitest";
import { contrast, ensureContrast, parseColor, pickPalette, ensureReadableOnWhite } from "@/lib/color";

describe("colour utilities", () => {
  it("parses hex, rgb and hsl", () => {
    expect(parseColor("#f60")).toEqual([255, 102, 0]);
    expect(parseColor("rgb(23, 105, 224)")).toEqual([23, 105, 224]);
    expect(parseColor("hsl(0, 100%, 50%)")).toEqual([255, 0, 0]);
    expect(parseColor("rgba(0,0,0,0.1)")).toBeNull(); // mostly transparent is ignored
  });

  it("always returns an AA-compliant pair", () => {
    for (const c of ["#ffd700", "#1769e0", "#7fffd4", "#ff6600", "#cccccc", "#000000"]) {
      const { bg, fg } = ensureContrast(c);
      expect(contrast(bg, fg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("darkens light brand colours used as text on white", () => {
    const c = ensureReadableOnWhite("#ffcc00");
    expect(contrast(c, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("prefers theme-color and brand variables over incidental colours", () => {
    const p = pickPalette(
      [
        { color: [220, 38, 38], weight: 12, source: "meta theme-color" },
        { color: [0, 123, 255], weight: 3, source: "stylesheet" },
        { color: [22, 163, 74], weight: 6, source: "CSS variable --accent" },
        { color: [240, 240, 240], weight: 40, source: "stylesheet" }, // neutral, ignored
      ],
      { primary: "#1769e0", secondary: "#0f2a4a", accent: "#12b886" },
    );
    expect(p.source).toBe("site");
    expect(parseColor(p.primary)![0]).toBeGreaterThan(150); // red family
    expect(contrast(p.primary, p.onPrimary)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.accent, p.onAccent)).toBeGreaterThanOrEqual(4.5);
  });

  it("falls back to the Fise palette for monochrome sites", () => {
    const p = pickPalette([{ color: [250, 250, 250], weight: 10, source: "x" }], {
      primary: "#1769e0", secondary: "#0f2a4a", accent: "#12b886",
    });
    expect(p.source).toBe("default");
  });
});
