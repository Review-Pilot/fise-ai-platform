import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Script } from 'node:vm';
import worker from '../src/index.js';

const origin = 'https://fise-ai-platform.seb-slabbert1.workers.dev';

function environment() {
  const queries = [];
  const DB = {
    prepare(sql) {
      queries.push(sql);
      return {
        bind() { return this; },
        async first() {
          if (sql.includes('FROM sessions JOIN users')) {
            return { id: 'test-user', email: 'test@example.invalid', password_set: 1 };
          }
          if (sql.includes('FROM website_state')) {
            return { content_json: '{}', revision: 1, updated_at: '', updated_by: '' };
          }
          throw new Error(`Unexpected query: ${sql}`);
        },
      };
    },
  };
  return { env: { DB }, queries };
}

test('legacy public links reach a published canonical destination without a DB read', async () => {
  for (const [oldPath, destination] of Object.entries({
    '/ai-chatbots': '/#features',
    '/pricing': '/#pricing',
    '/resources': '/blog',
    '/privacy': '/privacy-policy',
    '/terms': '/terms-and-conditions',
  })) {
    const { env, queries } = environment();
    const response = await worker.fetch(new Request(origin + oldPath), env);
    assert.equal(response.status, 303, oldPath);
    assert.equal(response.headers.get('location'), destination, oldPath);
    assert.equal(queries.length, 0, oldPath);
  }
});

test('older public pages link directly to live destinations', async () => {
  const { env } = environment();
  const response = await worker.fetch(new Request(origin + '/about'), env);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /href="\/#pricing"/);
  assert.match(html, /href="\/blog"/);
  assert.doesNotMatch(html, /href="\/(pricing|resources|privacy|terms|ai-chatbots)"/);
});

test('profile route is private and renders only the account interface', async () => {
  const anonymous = environment();
  const denied = await worker.fetch(new Request(origin + '/profile'), anonymous.env);
  assert.equal(denied.headers.get('location'), '/login');

  const signedIn = environment();
  const page = await worker.fetch(new Request(origin + '/profile?tab=subscription', {
    headers: { cookie: 'fise_session=test-session' },
  }), signedIn.env);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /class="profile-route"/);
  assert.match(html, /data-profile-panel="subscription"/);
  assert.doesNotMatch(html, /class="reference-hero"/);
  assert.doesNotMatch(html, /class="demo-browser"/);
  assert.equal(signedIn.queries.filter(sql => sql.includes('FROM website_state')).length, 0);
  for (const [, javascript] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    assert.doesNotThrow(() => new Script(javascript));
  }
});

test('an older dashboard failure cannot replace a newer navigation', async () => {
  const { env } = environment();
  const page = await worker.fetch(new Request(origin + '/profile', {
    headers: { cookie: 'fise_session=test-session' },
  }), env);
  const html = await page.text();
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
  const match = script.match(/    async function loadDashboardFrame\(frame,requestUrl='\/dashboard\?embed=1',requestOptions=\{\}\)\{[\s\S]*?\n    \}\n    function renderChatbots/);
  assert.ok(match, 'dashboard navigation handler is present');
  const handler = match[0].replace(/\n    function renderChatbots[\s\S]*$/, '');
  let rejectOld;
  let rejectNew;
  const pending = [
    new Promise((_, reject) => { rejectOld = reject; }),
    new Promise((_, reject) => { rejectNew = reject; }),
  ];
  let requestCount = 0;
  const navigate = new Function(
    'fetch', 'dashboardFrameError', 'location', 'demoLock',
    'closeProfile', 'openAccount', 'bindDashboardFrame',
    handler + '\nreturn loadDashboardFrame;',
  )(
    () => pending[requestCount++],
    (frame, message) => { frame.srcdoc = 'ERROR: ' + message; },
    { href: origin }, null, () => {}, () => {}, () => {},
  );
  const frame = {
    dataset: {},
    setAttribute() {},
    removeAttribute() {},
  };
  const oldNavigation = navigate(frame, '/dashboard?embed=1');
  const newNavigation = navigate(frame, '/dashboard/chatbots/new/settings?embed=1');
  rejectOld(new Error('old request failed'));
  await oldNavigation;
  assert.equal(frame.srcdoc, undefined, 'the older failure did not replace the newer screen');
  rejectNew(new Error('new request failed'));
  await newNavigation;
  assert.equal(frame.srcdoc, 'ERROR: new request failed');
});

test('an unexpected dashboard database failure renders a page instead of crashing the worker', async () => {
  // Regression test for the Cloudflare "Error 1101: Worker threw exception" bug:
  // route handlers are async functions, so `return handler(request, env)` inside
  // the top-level try/catch does NOT catch a later rejection from that returned
  // promise (only `return await handler(...)` does). Any unexpected DB failure
  // deep in a route therefore used to reject worker.fetch() itself, which
  // Cloudflare reports as a raw, unstyled "Worker threw exception" instead of
  // the app's own error page. This asserts fetch() always resolves.
  const DB = {
    prepare(sql) {
      return {
        bind() { return this; },
        async first() {
          if (sql.includes('FROM sessions JOIN users')) {
            return { id: 'test-user', email: 'test@example.invalid', password_set: 1 };
          }
          throw new Error(`Unexpected first(): ${sql}`);
        },
        // run()/all() are intentionally missing to simulate an unexpected
        // failure at any point in the dashboard's DB calls.
      };
    },
  };
  const request = new Request(origin + '/dashboard', {
    headers: { cookie: 'fise_session=test-session' },
  });
  const response = await worker.fetch(request, { DB });
  assert.equal(response.status, 200, 'the dashboard still renders instead of the request rejecting');
  const html = await response.text();
  assert.match(html, /Dashboard/);
});

test('website menu retains its links if configuration fails and uses direct destinations', async () => {
  const { env } = environment();
  const response = await worker.fetch(new Request(origin + '/website-frame.js'), env);
  assert.equal(response.status, 200);
  const javascript = await response.text();
  const run = new Function('document', 'fetch', javascript);
  const nav = { innerHTML: '', style: { visibility: 'hidden' } };
  const document = {
    getElementById(id) { return id === 'fise-global-nav' ? nav : null; },
    createElement() { return { set textContent(value) { this.innerHTML = value; }, innerHTML: '' }; },
    querySelectorAll() { return []; },
    documentElement: { style: { setProperty() {} } },
  };
  run(document, async () => ({ ok: false, json: async () => ({}) }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(nav.style.visibility, 'visible', 'the existing menu stays usable');

  nav.style.visibility = 'hidden';
  run(document, async () => ({ ok: true, json: async () => ({}) }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(nav.style.visibility, 'visible');
  for (const path of ['/#features', '/#pricing', '/blog']) {
    assert.ok(nav.innerHTML.includes('href="' + path + '"'), path);
  }
  assert.doesNotMatch(nav.innerHTML, /href="\/(?:ai-chatbots|pricing|resources)"/);
});
