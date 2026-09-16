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
  const timestamp = Math.floor(Date.now() / 1000);
  const claims = { email: 'student@example.edu', exp: timestamp + 3600, amr: [{ method: options.method || 'otp', timestamp: options.old ? timestamp - 7200 : timestamp }] };
  const token = `test.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
  let handler;
  const env = { REGISTRATION_OPEN: options.closed ? 'false' : 'true', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'public-test-key', SUPABASE_SERVICE_ROLE_KEY: 'server-test-key', RATE_LIMIT_SALT: 'test-only-salt' };
  const client = {
    auth: { getUser: async (receivedToken) => {
      calls.auth++;
      return receivedToken !== token || options.invalid ? { error: {}, data: { user: null } } : { data: { user: { id: 'verified-user-id', email: 'student@example.edu', email_confirmed_at: options.unconfirmed ? null : '2026-01-01T00:00:00Z', is_anonymous: options.anonymous, phone: options.phone || '' } } };
    } },
    rpc: async (name, args) => {
      if (name === 'consume_application_rate_limit') { calls.hashes.push(args.request_source_hash); return { data: !options.limited }; }
      assert.equal(name, 'reserve_team_join'); calls.reservations++; return { data: 'request-id' };
    },
    from: () => ({ insert: (data) => { calls.inserts.push(data); return { select: () => ({ single: async () => options.duplicate ? { error: { code: '23505' } } : { data: { id: 'application-id' } } }) }; } }),
  };
  vm.runInNewContext(source, { Deno: { env: { get: key => env[key] }, serve: fn => { handler = fn; } }, createClient: () => client, Request, Response, TextEncoder, URL, crypto: webcrypto, atob, console });
  return { calls, token, request: async (body = payload, headers = {}) => {
    const request = new Request('https://example.test/submit', { method: 'POST', headers: { Origin: 'https://codeclashtu.com', 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...headers }, body: JSON.stringify(body) });
    const response = await handler(request);
    return { status: response.status, body: await response.json() };
  } };
}

test('missing or forged token cannot read duplicate state or insert applications', async () => {
  for (const authorization of ['', 'Bearer forged.token.signature']) {
    const h = harness(); const result = await h.request(payload, { Authorization: authorization });
    assert.equal(result.status, 401); assert.equal(h.calls.inserts.length, 0); assert.equal(h.calls.hashes.length, 0);
  }
});
test('unconfirmed, anonymous, password-only, phone-auth and old sessions are rejected', async () => {
  for (const options of [{ unconfirmed: true }, { anonymous: true }, { method: 'password' }, { phone: '15550000000' }, { old: true }]) {
    const h = harness(options); assert.equal((await h.request()).status, 401); assert.equal(h.calls.inserts.length, 0);
  }
});
test('verified email cannot be replaced with another address', async () => {
  const h = harness(); assert.equal((await h.request({ ...payload, schoolEmail: 'other@example.edu' })).status, 403); assert.equal(h.calls.inserts.length, 0);
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
test('account rate limit rejects before insertion', async () => {
  const h = harness({ limited: true }); assert.equal((await h.request()).status, 429); assert.equal(h.calls.inserts.length, 0);
});
test('closed registration denies requests before auth or database access', async () => {
  const h = harness({ closed: true }); assert.equal((await h.request()).status, 403); assert.equal(h.calls.auth, 0); assert.equal(h.calls.inserts.length, 0);
});
test('null and array request bodies fail cleanly', async () => {
  const h = harness(); assert.equal((await h.request(null)).status, 400); assert.equal((await h.request([])).status, 400);
});
test('magic-link sessions can submit using their verified address', async () => {
  const h = harness({ method: 'magiclink' }); assert.equal((await h.request()).status, 200); assert.equal(h.calls.inserts[0].school_email, payload.schoolEmail);
});
