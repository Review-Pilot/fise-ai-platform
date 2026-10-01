// Takes a REAL screenshot of a Fise chatbot (Version 2 widget): opens the public chat link in a
// headless browser, asks one question, waits for the chatbot's actual answer and photographs it.
import { chromium } from "playwright-core";
import sharp from "sharp";
import { config } from "../config";
import { assertPublicHost } from "../http";
import { saveGraphic } from "../email/graphic";

export interface ChatPhoto {
  file: string;
  width: number;
  height: number;
  bytes: number;
  question: string;
  reply: string;
  alt: string;
}

export async function captureChatPhoto(opts: {
  chatLink: string;
  question: string;
  fileBase: string;
  /** e.g. "Kin Electrical's Fise chatbot" or "Example of a Fise chatbot" — used in the image alt text. */
  subject: string;
  timeoutMs?: number;
}): Promise<ChatPhoto> {
  const url = new URL(opts.chatLink);
  await assertPublicHost(url.hostname);
  const key = decodeURIComponent(url.pathname.split("/chat/")[1] ?? "").split("/")[0];
  if (!key) throw new Error("That doesn't look like a Fise chat link (/chat/<key>)");
  // The v2 widget plays a daily intro video; mark today's intro as seen and start a fresh conversation.
  const storageKey = `fise-chat-${key.slice(-16)}`;
  const init = `try{const d=new Date();localStorage.setItem(${JSON.stringify(`${storageKey}-v2-video-intro-date-v2`)},[d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-"));localStorage.removeItem(${JSON.stringify(storageKey)})}catch{}`;

  const browser = await chromium.launch({ headless: true, executablePath: config.chromiumPath || undefined });
  try {
    const context = await browser.newContext({ viewport: { width: 480, height: 700 }, deviceScaleFactor: 1 });
    await context.addInitScript(init);
    const page = await context.newPage();
    await page.goto(opts.chatLink, { waitUntil: "domcontentloaded", timeout: 30000 });
    // Playwright selectors pierce the widget's open shadow DOM.
    await page.locator(".launcher").first().click({ timeout: 30000 });
    const input = page.locator(".input").first();
    await input.waitFor({ state: "visible", timeout: 15000 });
    const answers = page.locator(".row.assistant .bubble:not(.typing-bubble)");
    const before = await answers.count();
    await input.fill(opts.question);
    await input.press("Enter");

    const deadline = Date.now() + (opts.timeoutMs ?? 60000);
    let reply = "";
    let stableSince = 0;
    while (Date.now() < deadline) {
      await page.waitForTimeout(500);
      if ((await answers.count()) <= before) continue;
      const text = (await answers.last().innerText()).trim();
      if (text && text === reply) {
        stableSince ||= Date.now();
        if (Date.now() - stableSince > 2500) break;
      } else {
        reply = text;
        stableSince = 0;
      }
    }
    if (!reply) throw new Error("The chatbot did not answer within the time limit");
    await page.waitForTimeout(700); // let the message animation finish
    // The widget fills the window, so a short chat leaves a blank gap. Make the window as tall as the
    // conversation needs (plus the message box) and let the widget lay itself out again — no cropping.
    const box = await answers.last().boundingBox();
    if (box) {
      const needed = Math.min(700, Math.max(380, Math.ceil(box.y + box.height) + 150));
      await page.setViewportSize({ width: 480, height: needed });
      await page.waitForTimeout(500);
    }
    const png = await page.screenshot({ type: "png" });

    let out: Buffer | null = null;
    for (const colours of [256, 128, 64]) {
      const candidate = await sharp(png).png({ palette: true, colours, compressionLevel: 9, effort: 8 }).toBuffer();
      if (candidate.length < 150_000) {
        out = candidate;
        break;
      }
    }
    out ??= await sharp(png).jpeg({ quality: 72 }).toBuffer();
    const saved = await saveGraphic(opts.fileBase, out);
    const shortReply = reply.replace(/\s+/g, " ").slice(0, 240);
    return {
      ...saved,
      question: opts.question,
      reply,
      alt: `Screenshot of ${opts.subject}. Customer asks: "${opts.question}" The chatbot answers: "${shortReply}"`.slice(0, 480),
    };
  } finally {
    await browser.close();
  }
}
