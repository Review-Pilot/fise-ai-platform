import { ok, bad, route } from "@/lib/api";
import { DEFAULT_SETTINGS, getSettings, updateSettings, type Settings } from "@/lib/settings";
import { checkDns } from "@/lib/dnscheck";
import { rescoreAll } from "@/lib/rescore";
import { importDnc, removeDnc } from "@/lib/dnc";
import { logEvent } from "@/lib/db";
import { parseColor } from "@/lib/color";

/** Coerce incoming values to the type of the default so the stored settings stay well-typed. */
function coerce(section: keyof Settings, patch: Record<string, unknown>) {
  const defaults = DEFAULT_SETTINGS[section] as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in defaults)) continue;
    const d = defaults[k];
    if (typeof d === "number") {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) throw new Error(`${k} must be a positive number`);
      out[k] = n;
    } else if (typeof d === "boolean") out[k] = v === true || v === "true" || v === "on";
    else if (Array.isArray(d)) out[k] = Array.isArray(v) ? v.map(String).filter(Boolean) : String(v).split("\n").map((s) => s.trim()).filter(Boolean);
    else if (d && typeof d === "object") {
      const obj = v as Record<string, string>;
      if (k === "defaultColors" && !Object.values(obj).every((c) => parseColor(c))) throw new Error("Invalid colour");
      out[k] = obj;
    } else out[k] = v === null ? null : String(v);
  }
  return out;
}

export const PATCH = route(async (req: Request) => {
  const { section, patch } = await req.json();
  if (!(section in DEFAULT_SETTINGS)) return bad("Unknown settings section");
  const clean = coerce(section, patch ?? {});
  if (section === "calls" && clean.testMode === false && !getSettings().calls.testPassedAt) {
    return bad("Make a successful test call to your own number before switching test mode off.");
  }
  if (section === "sending" && clean.paused === false && getSettings().sending.paused) {
    clean.pauseReason = null;
    logEvent(null, "email", "sending_resumed", "manually");
  }
  return ok({ value: updateSettings(section, clean as never) });
});

export const POST = route(async (req: Request) => {
  const b = await req.json();
  switch (b.action) {
    case "dns":
      return ok(await checkDns());
    case "rescore": {
      const r = rescoreAll();
      return ok({ message: `${r.qualified} qualified, ${r.excluded} excluded` });
    }
    case "dnc_import": {
      const r = importDnc(String(b.text ?? ""), "manual import");
      return ok({ message: `${r.added} added${r.skipped ? `, ${r.skipped} not recognised` : ""}` });
    }
    case "dnc_remove":
      removeDnc(String(b.value));
      logEvent(null, "system", "dnc_removed", String(b.value));
      return ok({ message: "Removed" });
    default:
      return bad("Unknown action");
  }
});
