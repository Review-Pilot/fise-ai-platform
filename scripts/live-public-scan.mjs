import assert from 'node:assert/strict';

const origin = process.env.FISE_ORIGIN || 'https://fise-ai-platform.seb-slabbert1.workers.dev';
const pages = [
  '/', '/about', '/blog', '/contact', '/help', '/cookies',
  '/privacy-policy', '/terms-and-conditions', '/login', '/demo',
];
const redirects = new Map([
  ['/ai-chatbots', '/#features'],
  ['/pricing', '/#pricing'],
  ['/resources', '/blog'],
  ['/privacy', '/privacy-policy'],
  ['/terms', '/terms-and-conditions'],
  ['/profile', '/login'],
]);
const checked = new Map();
const pageHtml = new Map();

async function request(path) {
  const started = performance.now();
  const response = await fetch(new URL(path, origin), {
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
    headers: { 'user-agent': 'Fise-public-navigation-audit/1.0' },
  });
  return { response, ms: Math.round(performance.now() - started) };
}

for (const path of pages) {
  const { response, ms } = await request(path);
  assert.equal(response.status, 200, path + ' must return a page');
  assert.match(response.headers.get('content-type') || '', /text\/html/, path);
  const html = await response.text();
  assert.match(html, /<html\b/i, path);
  pageHtml.set(path, html);
  checked.set(path, response.status);
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  const ids = new Set([...markup.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  for (const [, fragment] of markup.matchAll(/<a\b[^>]*\bhref="#([^"]+)"/g)) {
    assert.ok(ids.has(decodeURIComponent(fragment)), path + ' has a missing #' + fragment + ' target');
  }
  console.log(path + ': ' + response.status + ', ' + ms + ' ms, ' + html.length + ' chars');
}

for (const [path, destination] of redirects) {
  const { response, ms } = await request(path);
  assert.ok(response.status >= 300 && response.status < 400, path + ' should redirect');
  assert.equal(response.headers.get('location'), destination, path + ' redirect target');
  checked.set(path, response.status);
  console.log(path + ': ' + response.status + ' -> ' + destination + ', ' + ms + ' ms');
}

const rootIds = new Set([...pageHtml.get('/').matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
const localLinks = new Set();
for (const [page, html] of pageHtml) {
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  for (const [, rawHref] of markup.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)) {
    if (/^(?:mailto:|tel:|javascript:|data:)/i.test(rawHref)) continue;
    const href = rawHref.replaceAll('&amp;', '&');
    const target = new URL(href, new URL(page, origin));
    if (target.origin !== new URL(origin).origin) continue;
    if (target.hash && target.pathname === '/') {
      assert.ok(rootIds.has(decodeURIComponent(target.hash.slice(1))), page + ' links to missing ' + target.hash);
    }
    if (target.hash && target.pathname === page) {
      const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
      assert.ok(ids.has(decodeURIComponent(target.hash.slice(1))), page + ' links to missing ' + target.hash);
    }
    localLinks.add(target.pathname + target.search);
  }
}
for (const path of [...localLinks].sort()) {
  if (checked.has(path)) continue;
  const { response, ms } = await request(path);
  assert.ok(response.status >= 200 && response.status < 400, path + ' returned ' + response.status);
  if (response.status >= 300) {
    assert.ok(response.headers.get('location'), path + ' redirected without a destination');
  }
  checked.set(path, response.status);
  console.log('linked ' + path + ': ' + response.status + ', ' + ms + ' ms');
}

const { response: menuResponse } = await request('/website-frame.js');
assert.equal(menuResponse.status, 200);
const menuJs = await menuResponse.text();
for (const link of ['href="/#features"', 'href="/#pricing"', 'href="/blog"']) {
  assert.ok(menuJs.includes(link), 'deployed menu misses ' + link);
}
console.log('Deployed menu: canonical links confirmed');

const samples = [];
for (let i = 0; i < 3; i++) {
  const { response, ms } = await request('/');
  assert.equal(response.status, 200);
  await response.arrayBuffer();
  samples.push(ms);
}
samples.sort((a, b) => a - b);
console.log(JSON.stringify({
  origin,
  pagesChecked: pages.length,
  redirectsChecked: redirects.size,
  uniqueLocalLinksChecked: localLinks.size,
  totalPathsChecked: checked.size,
  homeGetMsFromRunner: samples,
  medianHomeGetMsFromRunner: samples[1],
}, null, 2));
