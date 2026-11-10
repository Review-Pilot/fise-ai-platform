// Hosted email images live in DATA_DIR/images and are served from your own domain at /i/<file>.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { config } from "../config";

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
  return { file, width: meta.width ?? 480, height: meta.height ?? 0, bytes: buf.length };
}
