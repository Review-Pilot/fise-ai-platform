// A tiny fake small-business website for integration tests.
import http from "node:http";
import sharp from "sharp";

export async function startFixtureSite(): Promise<{ url: string; close: () => void; hits: string[] }> {
  const logo = await sharp({ create: { width: 60, height: 30, channels: 3, background: { r: 200, g: 30, b: 45 } } }).png().toBuffer();
  const hits: string[] = [];
  const pages: Record<string, [string, string]> = {
    "/robots.txt": ["text/plain", "User-agent: *\nDisallow: /private\n"],
    "/": ["text/html", `<!doctype html><html><head><title>Kin Electrical | Electricians in Claremont</title>
      <meta name="theme-color" content="#c81e2d">
      <link rel="stylesheet" href="/wp-content/themes/kin/style.css">
      <link rel="icon" href="/favicon.png"></head>
      <body><header><img class="custom-logo" src="/logo.png" alt="Kin Electrical logo"></header>
      <nav><a href="/about-us/">About</a> <a href="/contact/">Contact</a> <a href="/private/team">Team</a></nav>
      <h1>Certified electricians in Claremont, Cape Town</h1>
      <p>We do compliance certificates (COCs), DB board upgrades, solar and backup power installs and emergency call-outs for homes across the Southern Suburbs.
      Family-owned since 2009. Call 021 555 1234.</p>
      <a class="btn" style="background:#c81e2d;color:#fff" href="/contact/">Get a quote</a>
      ${"<p>Reliable, friendly local service with clear quotes and tidy work on every job.</p>".repeat(6)}
      </body></html>`],
    "/about-us/": ["text/html", `<html><body><h1>About us</h1><p>Kin Electrical was founded by Thabo Mokoena, owner and master electrician. Our small team of 6 serves Claremont, Newlands and Rondebosch.</p></body></html>`],
    "/contact/": ["text/html", `<html><body><h1>Contact</h1><p>Email <a href="mailto:thabo@kinelectrical-fixture.co.za">thabo@kinelectrical-fixture.co.za</a> or office@kinelectrical-fixture.co.za</p>
      <a href="https://wa.me/27821234567">WhatsApp us</a><form class="wpcf7-form"><input name="name"><textarea name="msg"></textarea></form></body></html>`],
    "/private/team": ["text/html", "<p>SHOULD NOT BE FETCHED</p>"],
    "/wp-content/themes/kin/style.css": ["text/css", ":root{--primary-color:#c81e2d;--secondary:#1f2a44}.btn{background-color:#c81e2d}header{background:#1f2a44}a{color:#c81e2d}.x{color:#ffcc00}"],
  };
  const server = http.createServer((req, res) => {
    hits.push(`${req.url} ${req.headers["user-agent"]}`);
    if (req.url === "/logo.png") {
      res.writeHead(200, { "content-type": "image/png" });
      return res.end(logo);
    }
    const p = pages[req.url ?? ""];
    if (!p) {
      res.writeHead(404);
      return res.end("not found");
    }
    res.writeHead(200, { "content-type": p[0] });
    res.end(p[1]);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}/`, close: () => server.close(), hits };
}
