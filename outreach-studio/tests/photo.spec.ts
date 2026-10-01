import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startWidgetFixture } from "./fixtures/widget";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fos-photo-"));
process.env.ALLOW_PRIVATE_FETCH = "1";
if (!process.env.CHROMIUM_PATH && fs.existsSync("/opt/pw-browsers/chromium-1194/chrome-linux/chrome")) {
  process.env.CHROMIUM_PATH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
}

describe("real chatbot photo", () => {
  it("opens the chat, skips the daily intro, asks one real question, waits for the full answer and saves a small image", async () => {
    const fx = await startWidgetFixture();
    try {
      const { captureChatPhoto } = await import("@/lib/demo/photo");
      const p = await captureChatPhoto({ chatLink: fx.link, question: "Do you do emergency call-outs?", fileBase: "t1", subject: "the Kin Electrical Fise chatbot" });
      expect(fx.asked).toEqual(["Do you do emergency call-outs?"]); // exactly one message
      expect(p.reply).toMatch(/24\/7 across Cape Town/); // waited for the final text, not the partial one
      expect(p.alt).toMatch(/^Screenshot of the Kin Electrical Fise chatbot\. Customer asks: "Do you do emergency call-outs\?" The chatbot answers: "Yes, we do emergency call-outs 24\/7/);
      expect(p.width).toBeLessThanOrEqual(600);
      expect(p.height).toBeLessThan(500); // fits the short conversation, no big blank area
      expect(p.bytes).toBeLessThan(150_000);
      const file = path.join(process.env.DATA_DIR!, "images", p.file);
      expect(fs.statSync(file).size).toBe(p.bytes);
      fs.copyFileSync(file, path.join(process.env.DATA_DIR!, "photo-sample.png"));
    } finally {
      fx.close();
    }
  }, 120_000);

  it("fails instead of photographing an unanswered chat", async () => {
    const fx = await startWidgetFixture({ answer: false });
    try {
      const { captureChatPhoto } = await import("@/lib/demo/photo");
      await expect(captureChatPhoto({ chatLink: fx.link, question: "Hello?", fileBase: "t2", subject: "x", timeoutMs: 3000 })).rejects.toThrow(/did not answer/);
    } finally {
      fx.close();
    }
  }, 120_000);

  it("rejects links that aren't Fise chat links", async () => {
    const { captureChatPhoto } = await import("@/lib/demo/photo");
    await expect(captureChatPhoto({ chatLink: "http://127.0.0.1:1/about", question: "x", fileBase: "t3", subject: "x" })).rejects.toThrow(/chat link/);
  });
});
