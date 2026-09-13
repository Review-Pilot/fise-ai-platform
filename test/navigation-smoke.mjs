import assert from 'node:assert/strict';
import { test } from 'node:test';
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
});
