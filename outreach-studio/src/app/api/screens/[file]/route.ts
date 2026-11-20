import fs from "node:fs";
import path from "node:path";
import { config } from "@/lib/config";

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  if (!/^[\w-]+\.jpg$/.test(file)) return new Response("Not found", { status: 404 });
  const p = path.join(config.dataDir, "screens", file);
  if (!fs.existsSync(p)) return new Response("Not found", { status: 404 });
  return new Response(fs.readFileSync(p), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=60" } });
}
