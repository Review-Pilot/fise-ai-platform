import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { Script } from 'node:vm';
import worker from '../src/index.js';

const origin = 'https://fise-ai-platform.seb-slabbert1.workers.dev';
const publicPages = ['/', '/about', '/blog', '/help', '/contact', '/demo', '/privacy-policy', '/terms-and-conditions', '/cookies'];

function environment() {
  const writes = [];
  const DB = {
    prepare(sql) {
      return {
        args: [],
        bind(...args) { this.args = args; return this; },
        async first() {
          if (sql.includes('FROM website_state')) return { content_json: '{}', revision: 1, updated_at: '', updated_by: '' };
          return null;
        },
        async run() { writes.push({ sql, args: this.args }); return { success: true }; },
        async all() { return { results: [] }; },
      };
    },
  };
  return { env: { DB }, writes };
}

async function page(path) {
  const { env } = environment();
  const response = await worker.fetch(new Request(origin + path), env);
  return { response, html: await response.text() };
}

test('every public page has a title, description, canonical and Open Graph tags', async () => {
  for (const path of publicPages) {
    const { response, html } = await page(path);
    assert.equal(response.status, 200, path);
    assert.match(html, /<title>[^<]{8,}<\/title>/, path);
    assert.match(html, /<meta name="description" content="[^"]{20,}">/, path);
    assert.ok(html.includes(`<link rel="canonical" href="${origin}${path}">`), `${path} canonical`);
    assert.match(html, /<meta property="og:title"/, path);
    assert.ok(html.includes(`<meta property="og:image" content="${origin}/og-image.png">`), `${path} og:image`);
    assert.doesNotMatch(html, /__FX_(CANONICAL|ORIGIN)__/, path);
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, `${path} has exactly one h1`);
    assert.match(html, /<main id="main"/, `${path} skip-link target`);
  }
});

test('internal links on public pages resolve to live routes or assets', async () => {
  const seen = new Set();
  for (const path of publicPages) {
    const { html } = await page(path);
    for (const [, href] of html.matchAll(/href="(\/[^"#?]*)(?:[?#][^"]*)?"/g)) seen.add(href || '/');
  }
  for (const href of seen) {
    if (existsSync(new URL('../public' + href, import.meta.url)) && href !== '/') continue;
    const { env } = environment();
    const response = await worker.fetch(new Request(origin + href), env);
    assert.ok(response.status < 400, `${href} returned ${response.status}`);
    if (response.status >= 300) {
      const next = response.headers.get('location');
      assert.ok(next && next !== href, `${href} redirects somewhere new`);
    }
  }
});

test('homepage renders every redesigned section with accessible controls', async () => {
  const { html } = await page('/');
  for (const id of ['features', 'how', 'demo', 'insights', 'pricing', 'faq']) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /role="tablist"/);
  assert.match(html, /role="radiogroup" aria-label="Billing period"/);
  assert.match(html, /data-carousel/);
  assert.match(html, /aria-controls="fx-mobile-menu"/);
  assert.match(html, /R20,000 billed yearly/, 'annual price is 10x monthly');
  assert.match(html, /application\/ld\+json/);
  assert.doesNotMatch(html, /\\u[0-9a-f]{4}/i, 'no raw unicode escapes leak into markup');
  assert.doesNotMatch(html, /\bFin\b/, 'legacy assistant name typo is gone');
  assert.doesNotMatch(html, /streamable\.com|images\.unsplash\.com/, 'no third-party hero media');
  for (const [, javascript] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Script(javascript));
});

test('robots.txt and sitemap.xml describe the public site', async () => {
  const { env } = environment();
  const robots = await (await worker.fetch(new Request(origin + '/robots.txt'), env)).text();
  assert.match(robots, new RegExp(`Sitemap: ${origin}/sitemap.xml`));
  assert.match(robots, /Disallow: \/dashboard/);
  const sitemap = await (await worker.fetch(new Request(origin + '/sitemap.xml'), env)).text();
  for (const path of publicPages) assert.ok(sitemap.includes(`<loc>${origin}${path}</loc>`), path);
});

test('newsletter signup validates input, origin and stores the address', async () => {
  const post = (body, headers = { origin }) => worker.fetch(new Request(origin + '/api/newsletter', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  }), ctx.env);
  const ctx = environment();
  assert.equal((await post({ email: 'not-an-email' })).status, 400);
  assert.equal((await post({ email: 'a@b.co' }, { origin: 'https://evil.example' })).status, 403);
  const ok = await post({ email: 'Person@Example.co.za' });
  assert.equal(ok.status, 200);
  assert.ok(ctx.writes.some((w) => w.sql.startsWith('INSERT OR IGNORE INTO newsletter_subscribers') && w.args[0] === 'person@example.co.za'));
});

test('versioned stylesheets are cached immutably and the dead demo video route redirects', async () => {
  const { env } = environment();
  const css = await worker.fetch(new Request(origin + '/reference-styles.css?v=1'), env);
  assert.match(css.headers.get('cache-control'), /immutable/);
  const video = await worker.fetch(new Request(origin + '/fise-signup-demo.mp4'), env);
  assert.ok(video.status >= 300 && video.status < 400);
  assert.equal(video.headers.get('location'), '/fise-product-walkthrough.mp4');
});

test('checkout reflects the annual billing choice', async () => {
  const { html } = await page('/checkout?plan=grow&billing=annual');
  assert.match(html, /R20,000\/year/);
  assert.match(html, /noindex/);
});
