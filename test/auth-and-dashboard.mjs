import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/index.js';

const origin = 'https://fise-ai-platform.seb-slabbert1.workers.dev';

function authEnvironment({ failures = 0, user = null } = {}) {
  const statements = [];
  const DB = {
    prepare(sql) {
      return {
        args: [],
        bind(...args) { this.args = args; return this; },
        async first() {
          statements.push({ sql, args: this.args });
          if (sql.includes('FROM rate_limit_events')) return { total: failures };
          if (sql.includes('FROM users WHERE email=? OR username=?')) return user;
          return null;
        },
        async run() { statements.push({ sql, args: this.args }); return { success: true }; },
        async all() { return { results: [] }; },
      };
    },
  };
  return { env: { DB }, statements };
}

function form(fields) {
  const body = new URLSearchParams(fields);
  return { method: 'POST', headers: { origin, 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': '203.0.113.9' }, body };
}

test('password sign-in is throttled after repeated failures', async () => {
  const { env } = authEnvironment({ failures: 10 });
  const response = await worker.fetch(new Request(origin + '/api/auth/password', form({ identifier: 'a@b.co', password: 'wrong-password' })), env);
  assert.equal(response.status, 429);
  assert.match(await response.text(), /Too many sign-in attempts/);
});

test('an unknown account and a wrong password get the same answer and both count as failures', async () => {
  const unknown = authEnvironment();
  const r1 = await worker.fetch(new Request(origin + '/api/auth/password', form({ identifier: 'nobody@b.co', password: 'whatever-123' })), unknown.env);
  assert.equal(r1.status, 401);
  assert.match(await r1.text(), /The email and password do not match/);
  assert.ok(unknown.statements.some((s) => s.sql.startsWith('INSERT INTO rate_limit_events')));
  const known = authEnvironment({ user: { id: 'u1', email: 'a@b.co', username: 'a', password_hash: 'abc', password_salt: 'AAAAAAAAAAAAAAAAAAAAAA', password_iterations: 1000, status: 'active' } });
  const r2 = await worker.fetch(new Request(origin + '/api/auth/password', form({ identifier: 'a@b.co', password: 'whatever-123' })), known.env);
  assert.equal(r2.status, 401);
  assert.match(await r2.text(), /The email and password do not match/);
});

test('cross-origin auth posts are rejected', async () => {
  const { env } = authEnvironment();
  const request = new Request(origin + '/api/auth/password', { ...form({ identifier: 'a@b.co', password: 'x' }), headers: { origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal((await worker.fetch(request, env)).status, 403);
});

test('logout deletes the session and expires a hardened cookie', async () => {
  const { env, statements } = authEnvironment();
  const response = await worker.fetch(new Request(origin + '/logout', { method: 'POST', headers: { origin, cookie: 'fise_session=abc' } }), env);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /Max-Age=0/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.ok(statements.some((s) => s.sql.startsWith('DELETE FROM sessions')));
});

test('contact form honeypot silently drops bots without sending email', async () => {
  const { env } = authEnvironment();
  const response = await worker.fetch(new Request(origin + '/api/contact', form({ name: 'Bot', email: 'bot@b.co', message: 'spam', website: 'http://spam' })), env);
  assert.equal(response.headers.get('location'), '/contact?status=sent');
});

test('sign-in page offers tabs, a signup mode and a forgot-password path', async () => {
  const { env } = authEnvironment();
  const page = await (await worker.fetch(new Request(origin + '/login?mode=signup'), env)).text();
  assert.match(page, /role="tablist"/);
  assert.match(page, /data-initial="register"/);
  assert.match(page, /Create your Fise account/);
  assert.match(page, /Forgot your password\?/);
  assert.match(page, /\/dashboard-v2\.css\?v=/);
  assert.doesNotMatch(page, /<style>[\s\S]{20000,}<\/style>/, 'no large inline stylesheet');
});

test('dashboard shell has real navigation and a What’s new card', async () => {
  const bot = { id: 'bot-1', name: 'Alex', business_name: 'Biz', website_url: 'https://example.invalid', status: 'ready', public_key: 'pk', plan_code: 'grow', ui_settings_json: '{}', conversations_used: 3, lead_count: 2 };
  const DB = {
    prepare(sql) {
      return {
        bind() { return this; },
        async first() { return sql.includes('FROM sessions JOIN users') ? { id: 'u', email: 'u@example.invalid', password_set: 1 } : null; },
        async run() { return {}; },
        async all() { return sql.includes('FROM chatbots c') ? { results: [bot] } : { results: [] }; },
      };
    },
  };
  const html = await (await worker.fetch(new Request(origin + '/dashboard', { headers: { cookie: 'fise_session=x' } }), { DB })).text();
  assert.match(html, /class="app-sidebar"/);
  assert.match(html, /aria-current="page"[^>]*>|class="app-nav-link is-active" href="\/dashboard" aria-current="page"/);
  assert.match(html, /href="\/dashboard\/chatbots\/bot-1\/settings"/);
  assert.match(html, /What’s new/);
  assert.doesNotMatch(html, /Search actions|aria-label="Notifications"/);
});
