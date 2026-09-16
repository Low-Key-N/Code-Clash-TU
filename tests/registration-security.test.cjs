const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto } = require('node:crypto');
const source = stripTypeScriptTypes(fs.readFileSync('supabase/functions/submit-application/index.ts', 'utf8').replace(/^import .*\r?\n/, ''));
const payload = { fullName: 'Test Student', schoolEmail: 'student@example.edu', school: 'Test School', major: 'CS', graduationYear: 2027, experienceLevel: 'Beginner', desiredRoles: ['Builder'], projectInterests: 'A test project idea', teamStatus: 'solo', agreeToRules: true, confirmAccurate: true, formElapsedMs: 10000 };

function harness(options = {}) {
  const calls = { auth: 0, hashes: [], inserts: [], reservations: 0 };
  let handler;
  const env = { REGISTRATION_OPEN: options.closed ? 'false' : 'true', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'public-test-key', SUPABASE_SERVICE_ROLE_KEY: 'server-test-key', RATE_LIMIT_SALT: 'test-only-salt' };
  const client = {
    rpc: async (name, args) => {
      if (name === 'consume_application_rate_limit') { calls.hashes.push(args.request_source_hash); return { data: !options.limited }; }
      assert.equal(name, 'reserve_team_join'); calls.reservations++; return { data: 'request-id' };
    },
    from: () => ({ insert: (data) => { calls.inserts.push(data); return { select: () => ({ single: async () => options.duplicate ? { error: { code: '23505' } } : { data: { id: 'application-id' } } }) }; } }),
  };
  vm.runInNewContext(source, { Deno: { env: { get: key => env[key] }, serve: fn => { handler = fn; } }, createClient: () => client, Request, Response, TextEncoder, URL, crypto: webcrypto, atob, console });
  return { calls, request: async (body = payload, headers = {}) => {
    const request = new Request('https://example.test/submit', { method: 'POST', headers: { Origin: 'https://codeclashtu.com', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const response = await handler(request);
    return { status: response.status, body: await response.json() };
  } };
}

test('applications submit without an account or verification token', async () => {
  const h = harness(); const result = await h.request();
  assert.equal(result.status, 200); assert.equal(h.calls.inserts[0].school_email, payload.schoolEmail);
});
test('email normalization shares a rate bucket while other addresses do not', async () => {
  const h = harness();
  await h.request(); await h.request({ ...payload, schoolEmail: ' STUDENT@EXAMPLE.EDU ' });
  await h.request({ ...payload, schoolEmail: 'other@example.edu' });
  assert.equal(h.calls.hashes[0], h.calls.hashes[1]); assert.notEqual(h.calls.hashes[0], h.calls.hashes[2]);
});
test('rate key stays identical when caller-supplied IP headers change', async () => {
  const h = harness();
  assert.equal((await h.request(payload, { 'cf-connecting-ip': '192.0.2.1', 'x-forwarded-for': '192.0.2.2' })).status, 200);
  assert.equal((await h.request(payload, { 'cf-connecting-ip': '203.0.113.1', 'x-forwarded-for': '203.0.113.2' })).status, 200);
  assert.equal(h.calls.hashes.length, 2); assert.equal(h.calls.hashes[0], h.calls.hashes[1]); assert.match(h.calls.hashes[0], /^[a-f0-9]{64}$/);
});
test('new and duplicate applications return identical public receipts', async () => {
  const fresh = harness(), duplicate = harness({ duplicate: true });
  assert.deepEqual(await fresh.request(), await duplicate.request());
  const joining = { ...payload, teamStatus: 'joining', teamLookup: 'test-invite', joinRole: 'Builder' };
  const joined = harness(), prior = harness({ duplicate: true });
  assert.deepEqual(await joined.request(joining), await prior.request(joining));
  assert.equal(joined.calls.reservations, 1); assert.equal(prior.calls.reservations, 0);
});
test('email rate limit rejects before insertion', async () => {
  const h = harness({ limited: true }); assert.equal((await h.request()).status, 429); assert.equal(h.calls.inserts.length, 0);
});
test('closed registration denies requests before auth or database access', async () => {
  const h = harness({ closed: true }); assert.equal((await h.request()).status, 403); assert.equal(h.calls.auth, 0); assert.equal(h.calls.inserts.length, 0);
});
test('null and array request bodies fail cleanly', async () => {
  const h = harness(); assert.equal((await h.request(null)).status, 400); assert.equal((await h.request([])).status, 400);
});
test('validation and honeypot still prevent insertion', async () => {
  const h = harness();
  assert.equal((await h.request({ ...payload, schoolEmail: 'invalid' })).status, 422);
  assert.equal((await h.request({ ...payload, website: 'bot' })).status, 200);
  assert.equal((await h.request({ ...payload, formElapsedMs: 0 })).status, 400);
  assert.equal(h.calls.inserts.length, 0);
});
