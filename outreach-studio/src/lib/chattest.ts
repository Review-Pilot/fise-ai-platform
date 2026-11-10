// Opens a prospect's chat widget in a headless browser and sends ONE harmless question.
// Only runs for leads you explicitly approved; approval is consumed by the test (never bulk).
import fs from "node:fs";
import path from "node:path";
import { chromium, type Frame, type Page } from "playwright-core";
import { config } from "./config";
import { getLead, updateLead } from "./leads";
import { logEvent } from "./db";
import { openScriptFor } from "./site/widgets";
import { isBusinessHours, sastString } from "./hours";
import { assessChatReply, claudeEnabled } from "./claude";
import { refreshComparison } from "./site/analyze";
import { assertPublicHost, userAgent } from "./http";
import type { ChatTestResult } from "./types";

export const TEST_QUESTION = "Hi, what are your opening hours?";

const INPUT_SELECTORS = [
  "textarea",
  "[contenteditable='true']",
  "input[type='text'][placeholder*='message' i]",
  "input[placeholder*='type' i]",
  "input[placeholder*='write' i]",
  "input[placeholder*='ask' i]",
];
const LAUNCHER_SELECTORS = [
  "[aria-label*='chat' i]:visible",
  "[class*='launcher' i]:visible",
  "[id*='chat-button' i]:visible",
  "[class*='chat-button' i]:visible",
];

async function bodyText(frame: Frame): Promise<string> {
  try {
    return (await frame.locator("body").innerText({ timeout: 2000 })).replace(/\s+/g, " ");
  } catch {
    return "";
  }
}

async function findChatInput(page: Page): Promise<{ frame: Frame; selector: string } | null> {
  // Prefer iframes (almost all widgets render in one), then the main page.
  const frames = [...page.frames().filter((f) => f !== page.mainFrame()), page.mainFrame()];
  for (const frame of frames) {
    for (const sel of INPUT_SELECTORS) {
      const loc = frame.locator(sel).filter({ visible: true });
      const count = await loc.count().catch(() => 0);
      if (!count) continue;
      // On the main page, only accept inputs inside something that looks like a chat.
      if (frame === page.mainFrame()) {
        const inChat = await loc.last().evaluate((el) => Boolean(el.closest("[class*='chat' i], [id*='chat' i], [class*='messenger' i]"))).catch(() => false);
        if (!inChat) continue;
      }
      return { frame, selector: sel };
    }
  }
  return null;
}

export async function runChatTest(leadId: string): Promise<ChatTestResult> {
  const lead = getLead(leadId);
  if (!lead?.research) throw new Error("Research the lead first");
  if (!lead.chat_test_approved) throw new Error("Chat test not approved for this lead");
  const url = lead.research.finalUrl;
  await assertPublicHost(new URL(url).hostname);
  const tool = lead.research.chatTools.find((t) => t.category === "ai_chatbot" || t.category === "live_chat" || t.category === "messenger");
  const now = new Date();
  const result: ChatTestResult = {
    ranAt: now.toISOString(),
    localTime: sastString(now),
    afterHours: !isBusinessHours(now),
    tool: tool?.name,
    opened: false,
    question: TEST_QUESTION,
    observations: [],
  };
  // Consume the approval up-front so a crash can never cause a second message.
  updateLead(leadId, { chat_test_approved: 0 });

  const browser = await chromium.launch({ headless: true, executablePath: config.chromiumPath || undefined });
  try {
    const page = await browser.newPage({ userAgent: userAgent(), viewport: { width: 1280, height: 900 } });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(3000);

    const script = tool ? openScriptFor(tool.id) : undefined;
    if (script) await page.evaluate(script).catch(() => {});
    await page.waitForTimeout(2500);
    let input = await findChatInput(page);
    if (!input) {
      for (const sel of LAUNCHER_SELECTORS) {
        for (const frame of page.frames()) {
          const loc = frame.locator(sel).first();
          if (await loc.count().catch(() => 0)) {
            await loc.click({ timeout: 3000 }).catch(() => {});
            await page.waitForTimeout(2500);
            input = await findChatInput(page);
            if (input) break;
          }
        }
        if (input) break;
      }
    }

    if (!input) {
      result.observations.push(tool ? `The ${tool.name} widget could not be opened automatically.` : "No chat input could be found on the page.");
    } else {
      result.opened = true;
      const frame = input.frame;
      // Pre-chat forms: record, but never submit personal details.
      const prechat = await frame.locator("input[type='email']:visible, input[name*='email' i]:visible").count().catch(() => 0);
      if (prechat) {
        result.capturesLeads = true;
        result.observations.push("The chat asks visitors for their name/email before they can chat.");
      } else {
        const before = await bodyText(frame);
        const box = frame.locator(input.selector).filter({ visible: true }).last();
        await box.click({ timeout: 5000 });
        await box.fill(TEST_QUESTION).catch(async () => box.pressSequentially(TEST_QUESTION, { delay: 30 }));
        await box.press("Enter");
        const t0 = Date.now();
        let reply = "";
        let stableSince = 0;
        while (Date.now() - t0 < 60_000) {
          await page.waitForTimeout(1000);
          const after = await bodyText(frame);
          const fresh = after.replace(before, "").replace(TEST_QUESTION, "").trim();
          if (fresh.length > 15) {
            if (fresh === reply) {
              if (!stableSince) stableSince = Date.now();
              if (Date.now() - stableSince > 3000) break;
            } else {
              if (!reply) result.responseSeconds = Math.round((Date.now() - t0) / 100) / 10;
              reply = fresh;
              stableSince = 0;
            }
          }
        }
        if (reply) {
          result.reply = reply.slice(0, 1000);
          result.observations.push(`A reply appeared after about ${result.responseSeconds} seconds.`);
          result.observations.push(`Reply text: "${result.reply.slice(0, 300)}"`);
        } else {
          result.responseSeconds = null;
          result.observations.push("No reply appeared within 60 seconds.");
        }
      }
    }

    const dir = path.join(config.dataDir, "screens");
    fs.mkdirSync(dir, { recursive: true });
    result.screenshotFile = `${leadId}.jpg`;
    await page.screenshot({ path: path.join(dir, result.screenshotFile), type: "jpeg", quality: 60 });

    if (result.opened && !result.observations.some((o) => o.includes("name/email"))) {
      if (claudeEnabled()) {
        const a = await assessChatReply({
          tool: tool?.name ?? "unknown",
          question: TEST_QUESTION,
          reply: result.reply ?? null,
          responseSeconds: result.responseSeconds ?? null,
          afterHours: result.afterHours,
          widgetText: (await bodyText(input!.frame)).slice(0, 3000),
        }).catch(() => null);
        if (a) Object.assign(result, a);
      } else if (result.responseSeconds !== undefined && result.responseSeconds !== null) {
        result.looksLikeBot = result.responseSeconds < 6;
      }
    }
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    result.observations.push("The test could not complete; no conclusions drawn.");
  } finally {
    await browser.close();
  }

  updateLead(leadId, { chat_test: result });
  logEvent(leadId, "system", "chat_test", result.error ?? result.observations.join(" "));
  await refreshComparison(leadId).catch(() => {});
  return result;
}
