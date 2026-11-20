// Serves the REAL Fise v2 chat widget: the widget code is extracted from the Worker's own source
// (../src/index.js) and run against a stub API, so screenshots match what customers actually see.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
export const REAL_KEY = "fise_realwidgetkey_0123456789abcdef";

function widgetScript(): string {
  const src = fs.readFileSync(path.join(root, "src/index.js"), "utf8");
  const start = src.indexOf("function widgetBootstrapV2Clean");
  const end = src.indexOf("__name(widgetBootstrapV2Clean");
  if (start < 0 || end < 0) throw new Error("Could not find the v2 widget in src/index.js");
  const fn = src.slice(start, end);
  const shims = [...new Set(["__name", ...(fn.match(/__name\d*(?=\()/g) ?? [])])].map((id) => `const ${id}=(t)=>t;`).join("");
  return `(()=>{${shims}const legacy=function(){};const modern=${fn};const script=document.currentScript;if(!script||script.dataset.fiseLoaded==="1")return;script.dataset.fiseLoaded="1";const key=script.dataset.chatbotKey||"";if(!key)return;const api=new URL(script.src).origin;script.__fiseMount={legacy,modern};fetch(api+"/api/widget/config?key="+encodeURIComponent(key),{mode:"cors"}).then((r)=>r.ok?r.json():Promise.reject(new Error("Unavailable"))).then((config)=>{config.widget_version="2";script.__fiseConfig=config;modern(config,script)})})();`;
}

/** The inline script the /chat/:key page uses to open the widget fullscreen-style. */
function pageWiring(): string {
  const src = fs.readFileSync(path.join(root, "src/index.js"), "utf8");
  const m = src.match(/<script>\(\(\)=>\{const script=document\.querySelector\('script\[data-chatbot-key\]'\),details=[\s\S]*?<\\\/script>/);
  if (!m) throw new Error("Could not find the chat page script in src/index.js");
  return m[0].replace(/<\\\/script>$/, "</script>");
}

export async function startRealWidgetFixture(opts: { reply?: string; name?: string } = {}) {
  const asked: string[] = [];
  const widgetJs = widgetScript();
  const wiring = pageWiring();
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Chat</title>
  <style>*{box-sizing:border-box}html,body{height:100%}body{margin:0;background:#f5f4f1;font-family:system-ui,-apple-system,sans-serif}.version-control{position:fixed;top:24px;right:24px;z-index:2147483003}</style></head><body>
  <form class="version-control"><details class="version-picker" id="fise-version-picker"><summary><span id="fise-version-title">Version 2.1</span></summary><div class="version-picker-menu"><button type="button" class="version-picker-option" data-version="2">Version 2.1</button><button type="button" class="version-picker-option" data-version="1">Version 1.1</button></div></details></form>
  <script src="/widget.js" data-chatbot-key="${REAL_KEY}" data-preview="1" data-force-version="2"></script>${wiring}</body></html>`;
  const icon = fs.readFileSync(path.join(root, "public/chatbot-v2-icon.png"));
  const config = {
    widget_version: "2", name: opts.name ?? "Ceaser", business_name: opts.name ?? "Ceaser",
    popular_questions: ["How can CE help me?", "What does CE offer?", "How do I get started?", "Talk to us"],
    popular_question_icons_enabled: true, default_size: "large", allow_voice: true, allow_files: true,
    lead_capture: false, helpful_pages_enabled: false, widget_css: "",
  };
  const reply = opts.reply ?? "We repair and service fridges, washers, ovens, dryers, dishwashers, aircon and catering equipment, provide **preventative maintenance**, **upfront written quotes** and a workmanship guarantee.\n\nTo start, call or WhatsApp us on the phone numbers listed on the site to arrange a diagnosis and written quote.";
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const json = (o: unknown, status = 200) => { res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" }); res.end(JSON.stringify(o)); };
    if (url.pathname === "/widget.js") { res.writeHead(200, { "content-type": "application/javascript" }); return res.end(widgetJs); }
    if (url.pathname === "/chatbot-v2-icon.png") { res.writeHead(200, { "content-type": "image/png" }); return res.end(icon); }
    if (url.pathname === "/api/widget/config") return json(config);
    if (url.pathname === "/api/widget/chat" && req.method === "POST") {
      let b = ""; req.on("data", (c) => (b += c));
      req.on("end", () => { asked.push(JSON.parse(b).message); setTimeout(() => json({ conversation_id: "conv_1", reply, sources: [] }), 600); });
      return;
    }
    if (url.pathname.startsWith("/api/widget/")) return json({ conversations: [] });
    if (url.pathname.startsWith("/chat/")) { res.writeHead(200, { "content-type": "text/html" }); return res.end(page); }
    res.writeHead(404); res.end("nope");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return { link: `http://127.0.0.1:${port}/chat/${REAL_KEY}`, asked, close: () => server.close() };
}
