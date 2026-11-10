// A fake Fise v2 chat page with the same structure as the real widget: open shadow DOM host
// #fise-chat-widget, .launcher, .panel, .messages, .input, .row.user / .row.assistant .bubble,
// a typing bubble, and a daily intro overlay that blocks the chat until today's intro is marked as seen.
import http from "node:http";

export const KEY = "fise_testkey_abcdef1234567890";

export async function startWidgetFixture(opts: { answer?: boolean } = {}) {
  const answer = opts.answer ?? true;
  const asked: string[] = [];
  const page = `<!doctype html><html><body style="margin:0;background:#f5f4f1;font-family:sans-serif"><div class="version-control">Version 2.1</div>
  <div id="fise-chat-widget"></div>
  <script>
  const key = ${JSON.stringify(KEY)};
  const storageKey = "fise-chat-" + key.slice(-16);
  const d = new Date(); const day = [d.getFullYear(), String(d.getMonth()+1).padStart(2,"0"), String(d.getDate()).padStart(2,"0")].join("-");
  const needsIntro = localStorage.getItem(storageKey + "-v2-video-intro-date-v2") !== day;
  const root = document.getElementById("fise-chat-widget").attachShadow({ mode: "open" });
  root.innerHTML = '<style>.panel{display:none;position:fixed;inset:8px;background:#fff;border-radius:17px;flex-direction:column;border:1px solid #ddd}.panel.open{display:flex}.messages{flex:1;padding:16px;overflow:auto}.row{display:flex;margin-bottom:12px}.row.user{justify-content:flex-end}.bubble{padding:10px 14px;border-radius:14px;background:#eee;max-width:80%}.row.user .bubble{background:#1769e0;color:#fff}.daily-intro{position:absolute;inset:0;background:#000;color:#fff;z-index:5}.launcher{position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:28px;background:#1769e0;border:0}</style>' +
    '<button class="launcher" aria-label="Open chat"></button><section class="panel"><div class="messages"><div class="row assistant"><div class="bubble">Hi! How can I help you today?</div></div></div><form class="composer"><textarea class="input" placeholder="Type a message"></textarea></form></section>';
  const panel = root.querySelector(".panel"), messages = root.querySelector(".messages"), input = root.querySelector(".input");
  root.querySelector(".launcher").addEventListener("click", () => {
    panel.classList.add("open");
    document.querySelector(".version-control").style.display = "none";
    if (needsIntro) messages.insertAdjacentHTML("beforeend", '<section class="daily-intro">INTRO VIDEO</section>');
  });
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const q = input.value.trim(); input.value = "";
    fetch("/asked", { method: "POST", body: q });
    messages.insertAdjacentHTML("beforeend", '<div class="row user"><div class="bubble">' + q.replace(/</g, "&lt;") + '</div></div>');
    messages.insertAdjacentHTML("beforeend", '<div class="row assistant"><div class="bubble typing-bubble">...</div></div>');
    if (${answer}) setTimeout(() => {
      const t = messages.querySelector(".typing-bubble"); t.classList.remove("typing-bubble"); t.textContent = "Yes, we do emergency call-outs";
      setTimeout(() => { t.textContent = "Yes, we do emergency call-outs 24/7 across Cape Town. Send us your address and we will dispatch an electrician."; }, 900);
    }, 800);
  });
  </script></body></html>`;
  const server = http.createServer((req, res) => {
    if (req.url === "/asked" && req.method === "POST") {
      let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { asked.push(b); res.end("ok"); });
      return;
    }
    if (req.url?.startsWith(`/chat/${KEY}`)) { res.writeHead(200, { "content-type": "text/html" }); return res.end(page); }
    res.writeHead(404); res.end("nope");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return { link: `http://127.0.0.1:${port}/chat/${KEY}`, asked, close: () => server.close() };
}
