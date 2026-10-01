import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fos-chat-"));
process.env.ALLOW_PRIVATE_FETCH = "1";
delete process.env.ANTHROPIC_API_KEY;
if (!process.env.CHROMIUM_PATH && fs.existsSync("/opt/pw-browsers/chromium-1194/chrome-linux/chrome")) {
  process.env.CHROMIUM_PATH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
}

let received: string[] = [];
let server: http.Server;
let url = "";
beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/robots.txt") return res.end("");
    if (req.url === "/msg") {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => { received.push(b); res.end("ok"); });
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<html><body><h1>Test plumber</h1>
      <div class="chat-widget" style="position:fixed;bottom:0;right:0">
        <div id="log"></div><textarea id="box" placeholder="Type a message"></textarea>
      </div>
      <script>
        box.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault();
          const q = box.value; fetch('/msg', {method:'POST', body:q}); log.innerText += 'You: ' + q + '\\n'; box.value='';
          setTimeout(() => log.innerText += 'Bot: We are open Monday to Friday 8am to 5pm.\\n', 1200); } });
      </script></body></html>`);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
});
afterAll(() => server.close());

describe("chat test", () => {
  it("refuses without approval and sends exactly one question when approved", async () => {
    const { createLead, updateLead, getLead } = await import("@/lib/leads");
    const { runChatTest, TEST_QUESTION } = await import("@/lib/chattest");
    const lead = createLead({ business_name: "Test plumber", website: url });
    updateLead(lead.id, {
      research: {
        finalUrl: url, httpStatus: 200, fetchedAt: "", pages: [], blockedByRobots: [], parked: false, socialOnly: false,
        platform: "Custom HTML", platformEvidence: [], canInstall: "yes", canInstallReason: "",
        chatTools: [{ id: "custom", name: "Custom chat", category: "live_chat", evidence: "" }],
        services: [], corporateSignals: [], chainSignals: [], likelyCustomerQuestions: [], wordCount: 100,
      },
    });
    await expect(runChatTest(lead.id)).rejects.toThrow(/not approved/);

    updateLead(lead.id, { chat_test_approved: 1 });
    const r = await runChatTest(lead.id);
    expect(r.error).toBeUndefined();
    expect(r.opened).toBe(true);
    expect(received).toEqual([TEST_QUESTION]);
    expect(r.reply).toMatch(/Monday to Friday/);
    expect(r.responseSeconds).toBeGreaterThan(0.5);
    expect(r.looksLikeBot).toBe(true);
    const after = getLead(lead.id)!;
    expect(after.chat_test_approved).toBe(0); // approval consumed
    expect(after.comparison).toBeTruthy();
    await expect(runChatTest(lead.id)).rejects.toThrow(/not approved/);
  }, 120_000);
});
