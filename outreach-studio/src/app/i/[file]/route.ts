// Serves email graphics from your own domain.
import fs from "node:fs";
import path from "node:path";
import { imagesDir } from "@/lib/email/graphic";

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  if (!/^[\w-]+\.(png|jpg)$/.test(file)) return new Response("Not found", { status: 404 });
  const p = path.join(imagesDir(), file);
  if (!fs.existsSync(p)) return new Response("Not found", { status: 404 });
  return new Response(fs.readFileSync(p), {
    headers: {
      "content-type": file.endsWith(".png") ? "image/png" : "image/jpeg",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
