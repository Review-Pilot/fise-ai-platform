// Renders the Fise chat-widget mockup in the prospect's brand colours to a PNG
// (Satori → SVG → resvg → PNG, then palette-compressed with sharp to stay under 150 KB).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import { config } from "../config";
import { fetchBinary } from "../http";
import { parseColor, toHex, rgbToHsl, hslToRgb, ensureContrast, INK } from "../color";
import type { BrandColors, EmailCopy } from "../types";

const require = createRequire(import.meta.url);
let fonts: { name: string; data: Buffer; weight: 400 | 600 | 700; style: "normal" }[] | null = null;
function loadFonts() {
  if (!fonts) {
    const dir = path.dirname(require.resolve("@fontsource/inter/package.json"));
    fonts = ([400, 600, 700] as const).map((w) => ({
      name: "Inter",
      data: fs.readFileSync(path.join(dir, "files", `inter-latin-${w}-normal.woff`)),
      weight: w,
      style: "normal" as const,
    }));
  }
  return fonts;
}

type Node = { type: string; props: Record<string, unknown> & { style?: Record<string, unknown>; children?: unknown } };
const h = (type: string, style: Record<string, unknown>, children?: unknown, extra: Record<string, unknown> = {}): Node => ({
  type,
  props: { style: { display: "flex", ...style }, children, ...extra },
});

export const GRAPHIC_WIDTH = 560;

function tint(hex: string, lightness: number): string {
  const rgb = parseColor(hex) ?? [23, 105, 224];
  const [hh, s] = rgbToHsl(rgb);
  return toHex(hslToRgb(hh, Math.min(0.9, s), lightness));
}

/** Rough text height estimate so the canvas fits the messages. */
function linesFor(text: string, charsPerLine: number) {
  return Math.max(1, Math.ceil(text.length / charsPerLine));
}

async function logoDataUri(url?: string): Promise<string | null> {
  if (!url) return null;
  const img = await fetchBinary(url, 2_000_000);
  if (!img) return null;
  try {
    const png = await sharp(img.buf, { density: 144 })
      .resize(88, 88, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .flatten({ background: "#ffffff" })
      .png()
      .toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function renderChatGraphic(opts: {
  businessName: string;
  colors: BrandColors;
  messages: EmailCopy["chatMockup"];
  logoUrl?: string;
  timeLabel?: string;
}): Promise<Buffer> {
  const { colors } = opts;
  const logo = await logoDataUri(opts.logoUrl);
  const botBubble = tint(colors.primary, 0.94);
  const botText = INK;
  const visitorBubble = colors.primary;
  const visitorText = ensureContrast(colors.primary).fg;
  const messages = opts.messages.slice(0, 4);

  const bubbleWidth = 360;
  const msgHeights = messages.map((m) => linesFor(m.text, 44) * 21 + 24 + 12);
  const height = 72 + 34 + msgHeights.reduce((a, b) => a + b, 0) + 64 + 30 + 16;

  const initials = opts.businessName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

  const header = h(
    "div",
    { background: colors.primary, padding: "16px 18px", alignItems: "center", gap: 12, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
    [
      logo
        ? h("div", { width: 44, height: 44, borderRadius: 10, background: "#ffffff", alignItems: "center", justifyContent: "center", overflow: "hidden" }, [
            { type: "img", props: { src: logo, width: 40, height: 40, style: { objectFit: "contain" } } },
          ])
        : h("div", { width: 44, height: 44, borderRadius: 22, background: colors.onPrimary === "#ffffff" ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.08)", color: colors.onPrimary, alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 700 }, initials),
      h("div", { flexDirection: "column", color: colors.onPrimary }, [
        h("div", { fontSize: 17, fontWeight: 700 }, opts.businessName.slice(0, 34)),
        h("div", { fontSize: 13, alignItems: "center", gap: 6, opacity: 0.9 }, [
          h("div", { width: 8, height: 8, borderRadius: 4, background: "#22c55e" }),
          "Online now · replies in seconds",
        ]),
      ]),
    ],
  );

  const body = h(
    "div",
    { flexDirection: "column", padding: "12px 18px", gap: 12, background: "#ffffff", flexGrow: 1 },
    [
      h("div", { justifyContent: "center", fontSize: 12, color: "#6b7280" }, opts.timeLabel ?? "Today, 21:40"),
      ...messages.map((m) =>
        m.from === "visitor"
          ? h("div", { justifyContent: "flex-end" }, [
              h("div", { maxWidth: bubbleWidth, background: visitorBubble, color: visitorText, padding: "10px 14px", borderRadius: 16, borderBottomRightRadius: 4, fontSize: 15, lineHeight: 1.4 }, m.text),
            ])
          : h("div", { justifyContent: "flex-start", alignItems: "flex-end", gap: 8 }, [
              h("div", { width: 26, height: 26, borderRadius: 13, background: colors.primary, color: colors.onPrimary, fontSize: 11, fontWeight: 700, alignItems: "center", justifyContent: "center" }, "AI"),
              h("div", { maxWidth: bubbleWidth, background: botBubble, color: botText, padding: "10px 14px", borderRadius: 16, borderBottomLeftRadius: 4, fontSize: 15, lineHeight: 1.4 }, m.text),
            ]),
      ),
    ],
  );

  const input = h("div", { padding: "10px 18px 12px", background: "#ffffff", borderTop: "1px solid #e5e7eb", alignItems: "center", gap: 10 }, [
    h("div", { flexGrow: 1, fontSize: 14, color: "#6b7280", border: "1px solid #d1d5db", borderRadius: 20, padding: "9px 14px" }, "Type your message…"),
    h("div", { width: 38, height: 38, borderRadius: 19, background: colors.primary, alignItems: "center", justifyContent: "center" }, [
      {
        type: "svg",
        props: {
          width: 18, height: 18, viewBox: "0 0 24 24",
          children: [{ type: "path", props: { d: "M4 12h14M12 5l7 7-7 7", stroke: colors.onPrimary, strokeWidth: 2.5, fill: "none", strokeLinecap: "round", strokeLinejoin: "round" } }],
        },
      },
    ]),
  ]);

  const footer = h("div", { justifyContent: "center", fontSize: 11, color: "#6b7280", padding: "0 0 10px", background: "#ffffff", borderBottomLeftRadius: 16, borderBottomRightRadius: 16 }, "Powered by Fise");

  const root = h(
    "div",
    { width: GRAPHIC_WIDTH, height, padding: 8, background: "#eef1f5", fontFamily: "Inter" },
    [h("div", { flexDirection: "column", width: "100%", borderRadius: 16, border: "1px solid #d9dee5", background: "#ffffff" }, [header, body, input, footer])],
  );

  const svg = await satori(root as never, { width: GRAPHIC_WIDTH, height, fonts: loadFonts() });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: GRAPHIC_WIDTH } }).render().asPng();
  // Palette PNG keeps flat UI graphics small. Step colours down if still too big.
  for (const colours of [256, 128, 64]) {
    const out = await sharp(png).png({ palette: true, colours, compressionLevel: 9, effort: 8 }).toBuffer();
    if (out.length < 150_000) return out;
  }
  return sharp(png).jpeg({ quality: 70 }).toBuffer();
}

export function imagesDir() {
  const dir = path.join(config.dataDir, "images");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function saveGraphic(fileBase: string, buf: Buffer): Promise<{ file: string; width: number; height: number; bytes: number }> {
  const meta = await sharp(buf).metadata();
  const ext = meta.format === "jpeg" ? "jpg" : "png";
  const file = `${fileBase}-${Date.now().toString(36)}.${ext}`;
  fs.writeFileSync(path.join(imagesDir(), file), buf);
  return { file, width: meta.width ?? GRAPHIC_WIDTH, height: meta.height ?? 0, bytes: buf.length };
}
