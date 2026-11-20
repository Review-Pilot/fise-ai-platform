// Renders a sample (or a real) email at common client widths, with images on and off,
// and writes PNG screenshots to data/render-check/. Usage:
//   npm run render:check              → uses a built-in sample prospect
//   npm run render:check -- <emailId> → renders a saved draft
import nextEnv from "@next/env";
import fs from "node:fs";
import path from "node:path";

nextEnv.loadEnvConfig(process.cwd());
const { chromium } = await import("playwright-core");
const { config } = await import("../src/lib/config");
const { getEmail, generateEmail } = await import("../src/lib/email/build");
const { createLead, updateLead } = await import("../src/lib/leads");
const { finalisePalette } = await import("../src/lib/color");
const { imagesDir } = await import("../src/lib/email/graphic");

let emailId = process.argv[2];
if (!emailId) {
  const lead = createLead({ business_name: "Kin Electrical (sample)", website: "https://example.com", keyword: "electrician", city: "Cape Town", email: "thabo@example.com", contact_first_name: "Thabo" });
  updateLead(lead.id, {
    colors: finalisePalette("#c81e2d", "#1f2a44", "#12b886", "manual"),
    research_status: "done",
    comparison: "Right now, visitors who arrive after hours can only fill in your contact form and wait. Fise would answer straight away and pass you their details.",
    research: {
      finalUrl: "https://example.com", httpStatus: 200, fetchedAt: new Date().toISOString(), pages: [], blockedByRobots: [], parked: false,
      socialOnly: false, platform: "WordPress", platformEvidence: [], canInstall: "yes", canInstallReason: "", chatTools: [],
      industry: "Residential electrician", services: ["COC certificates", "DB board upgrades", "Solar and backup power"],
      location: "Claremont, Cape Town", tone: "friendly, practical", corporateSignals: [], chainSignals: [], wordCount: 600,
      likelyCustomerQuestions: ["Can you do a COC for a house sale this week?", "Do you install inverters in Claremont?", "My DB board keeps tripping, can someone come out?"],
    },
  });
  const res = await generateEmail(lead.id);
  emailId = res.email.id;
  console.log(`Generated sample email ${emailId} (${res.source})`);
}
const email = getEmail(emailId);
if (!email) throw new Error(`Email ${emailId} not found`);

// Point hosted image URLs at the local file so screenshots work before deployment.
let html = email.html;
if (email.image_file) {
  const b64 = fs.readFileSync(path.join(imagesDir(), email.image_file)).toString("base64");
  html = html.replaceAll(`${config.publicBaseUrl}/i/${email.image_file}`, `data:image/png;base64,${b64}`);
}
const imagesOff = html.replace(/<img\b([^>]*?)src="[^"]*"/g, '<img$1src="data:image/gif;base64,R0lGODlhAQABAAAAACw="');

const TARGETS = [
  { name: "gmail-desktop", width: 640, note: "Gmail web reading pane" },
  { name: "outlook-desktop", width: 800, note: "Outlook desktop reading pane (Chromium approximation; VML button covers real Outlook)" },
  { name: "apple-mail-iphone", width: 375, note: "Apple Mail on iPhone" },
  { name: "gmail-android", width: 360, note: "Gmail app on Android" },
];

const out = path.join(config.dataDir, "render-check");
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: config.chromiumPath || undefined });
const report: string[] = [];
for (const t of TARGETS) {
  for (const [label, content] of [["images-on", html], ["images-off", imagesOff]] as const) {
    const page = await browser.newPage({ viewport: { width: t.width, height: 900 } });
    await page.setContent(content, { waitUntil: "load" });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const file = path.join(out, `${t.name}-${label}.png`);
    await page.screenshot({ path: file, fullPage: true });
    report.push(`${t.name} (${t.width}px, ${label}): ${overflow > 1 ? `HORIZONTAL OVERFLOW ${overflow}px` : "fits"} → ${file}`);
    await page.close();
  }
}
await browser.close();
console.log(report.join("\n"));
console.log("\nChecks:");
for (const c of email.checks) console.log(`${c.ok ? "✓" : c.severity === "error" ? "✗" : "!"} ${c.label}${c.detail ? ` — ${c.detail}` : ""}`);
console.log("\nFor pixel-exact Outlook (Word engine) results, send a test to Litmus or Email on Acid.");
