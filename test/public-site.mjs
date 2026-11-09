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

function signedInEnvironment(hasChatbot) {
  const DB = {
    prepare(sql) {
      return {
        bind() { return this; },
        async first() {
          if (sql.includes('FROM website_state')) return { content_json: '{}', revision: 1, updated_at: '', updated_by: '' };
          if (sql.includes('FROM sessions JOIN users')) return { id: 'u', email: 'u@example.invalid', password_set: 1 };
          if (sql.includes('FROM chatbots WHERE user_id')) return hasChatbot ? { id: 'bot' } : null;
          return null;
        },
        async run() { return { success: true }; },
        async all() { return { results: [] }; },
      };
    },
  };
  return { DB };
}

test('signed-in header is rendered by the server so it never flashes the signed-out header', async () => {
  const request = () => new Request(origin + '/', { headers: { cookie: 'fise_session=x' } });
  const withBot = await (await worker.fetch(request(), signedInEnvironment(true))).text();
  assert.match(withBot, /id="demo-link" href="\/dashboard">Dashboard</);
  assert.match(withBot, />My profile</);
  assert.doesNotMatch(withBot, /href="\/login\?mode=signup"[^>]*>\s*Start free/);
  const noBot = await (await worker.fetch(request(), signedInEnvironment(false))).text();
  assert.match(noBot, />My profile</);
  assert.match(noBot, /href="\/login\?mode=signup"[^>]*>\s*Start free/);
  assert.match(noBot, /id="demo-link" href="\/demo">Live demo</);
  const anonymous = (await page('/')).html;
  assert.match(anonymous, />Sign in</);
  assert.match(anonymous, /href="\/login\?mode=signup"[^>]*>\s*Start free/);
});

test('widget popular questions come from the scanned site, not the typed business name', async () => {
  const bot = { id: 'b1', user_id: 'u', name: 'Assistant', business_name: 'Cape Tou', website_url: 'https://affordableroofing.co.za', status: 'ready', public_key: 'pk', vector_store_id: 'vs', primary_colour: '#111111', greeting: 'Hi', allowed_domains_json: '[]', monthly_message_limit: 500, popular_questions_json: '[]', ui_settings_json: '{"widget_version":"2"}', default_size: 'large', allow_files: 1, allow_voice: 1, lead_capture_enabled: 0, lead_cta_label: 'Talk to us', subscription_status: 'active', plan_code: 'grow' };
  const pages = [
    { title: 'Affordable Roofing | Roof Repairs Cape Town', source_url: 'https://affordableroofing.co.za/' },
    { title: 'Waterproofing - Affordable Roofing', source_url: 'https://affordableroofing.co.za/waterproofing' },
    { title: 'Contact Us | Affordable Roofing', source_url: 'https://affordableroofing.co.za/contact' },
  ];
  const makeEnv = (saved) => ({ DB: { prepare(sql) { return { bind() { return this; },
    async first() { return sql.includes('FROM chatbots c') ? { ...bot, popular_questions_json: saved } : null; },
    async run() { return {}; },
    async all() { return sql.includes('FROM knowledge_sources') ? { results: pages } : { results: [] }; } }; } } });
  const get = async (saved) => (await worker.fetch(new Request(origin + '/api/widget/config?key=pk', { headers: { origin } }), makeEnv(saved))).json();
  const generated = await get('[]');
  const joined = generated.popular_questions.join(' | ');
  assert.doesNotMatch(joined, /Cape Tou/);
  assert.match(joined, /Affordable Roofing|Waterproofing/);
  assert.ok(generated.popular_questions.length >= 3);
  const saved = await get(JSON.stringify(['How can Cape Tou help me?', 'What does Cape Tou offer?']));
  assert.doesNotMatch(saved.popular_questions.join(' '), /Cape Tou/);
  assert.match(saved.popular_questions[0], /Affordable Roofing/);
});
