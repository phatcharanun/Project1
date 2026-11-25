const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const { createApp } = require('./Node');
const { createAuthConfig } = require('./auth');

const servers = [];

// In-memory stand-in for the ioredis commands auth.js uses (TTL ignored).
function createFakeRedis() {
    const store = new Map();
    return {
        store,
        async get(key) { return store.get(key) ?? null; },
        async getdel(key) { const v = store.get(key) ?? null; store.delete(key); return v; },
        async set(key, value, ...args) {
            if (args.includes('NX') && store.has(key)) return null;
            store.set(key, String(value));
            return 'OK';
        },
        async del(...keys) { keys.forEach(k => store.delete(k)); return keys.length; },
        async incr(key) { const v = Number(store.get(key) || 0) + 1; store.set(key, String(v)); return v; },
        async expire() { return 1; }
    };
}

async function startApp({ activeDevice = null } = {}) {
    const mails = [];
    const pool = {
        query: async sql => (sql.includes('FROM user_device')
            ? { rowCount: activeDevice ? 1 : 0, rows: activeDevice ? [activeDevice] : [] }
            : { rowCount: 0, rows: [] })
    };
    const redis = createFakeRedis();
    const app = createApp(pool, {
        redis,
        sendMail: async mail => { mails.push(mail); },
        config: createAuthConfig({})
    });
    const server = app.listen(0);
    servers.push(server);
    await new Promise(resolve => server.once('listening', resolve));
    const post = async (path, body) => {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
        });
        return { status: response.status, body: await response.json() };
    };
    return { post, mails, redis };
}

const codeFrom = mail => mail.text.match(/\d{6}/)[0];

afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))));
});

test('OTP goes to the institution email derived from the student ID', async () => {
    const { post, mails, redis } = await startApp();
    const res = await post('/otp/request', { student_id: '6610301000' });
    assert.equal(res.status, 202);
    assert.equal(res.body.email, '6610301000@cdti.ac.th');
    assert.equal(mails[0].to, '6610301000@cdti.ac.th');
    assert.ok(!redis.store.get('otp:6610301000').includes(codeFrom(mails[0])), 'OTP stored hashed');
});

test('rejects malformed student IDs and enforces resend cooldown', async () => {
    const { post } = await startApp();
    assert.equal((await post('/otp/request', { student_id: 'abc' })).status, 400);
    assert.equal((await post('/otp/request', { student_id: '6610301000' })).status, 202);
    assert.equal((await post('/otp/request', { student_id: '6610301000' })).body.error, 'OTP_COOLDOWN');
});

test('correct OTP yields a single-use enrollment token and register options', async () => {
    const { post, mails } = await startApp();
    await post('/otp/request', { student_id: '6610301000' });
    const ok = await post('/otp/verify', { student_id: '6610301000', code: codeFrom(mails[0]) });
    assert.equal(ok.status, 200);
    assert.ok(ok.body.enrollment_token);

    const reused = await post('/otp/verify', { student_id: '6610301000', code: codeFrom(mails[0]) });
    assert.equal(reused.body.error, 'OTP_EXPIRED');

    const options = await post('/webauthn/register/options', { enrollment_token: ok.body.enrollment_token });
    assert.equal(options.status, 200);
    assert.equal(options.body.rp.id, 'localhost');
    assert.equal(options.body.authenticatorSelection.userVerification, 'required');
});

test('locks the OTP after 5 wrong attempts', async () => {
    const { post, mails } = await startApp();
    await post('/otp/request', { student_id: '6610301000' });
    const wrong = codeFrom(mails[0]) === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i += 1) {
        assert.equal((await post('/otp/verify', { student_id: '6610301000', code: wrong })).body.error, 'OTP_INCORRECT');
    }
    const locked = await post('/otp/verify', { student_id: '6610301000', code: codeFrom(mails[0]) });
    assert.equal(locked.body.error, 'OTP_TOO_MANY_ATTEMPTS');
});

test('refuses to bind a second device', async () => {
    const { post, mails } = await startApp({
        activeDevice: { credential_id: 'abc', public_key: 'x', sign_count: 0, transports: null }
    });
    await post('/otp/request', { student_id: '6610301000' });
    const { body } = await post('/otp/verify', { student_id: '6610301000', code: codeFrom(mails[0]) });
    const res = await post('/webauthn/register/options', { enrollment_token: body.enrollment_token });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'DEVICE_ALREADY_BOUND');
});

test('login options need a bound device and login verify needs a live challenge', async () => {
    const unbound = await startApp();
    assert.equal((await unbound.post('/webauthn/login/options', { student_id: '6610301000' })).body.error,
        'DEVICE_NOT_BOUND');

    const bound = await startApp({
        activeDevice: { credential_id: 'abc', public_key: 'x', sign_count: 0, transports: ['internal'] }
    });
    const options = await bound.post('/webauthn/login/options', { student_id: '6610301000' });
    assert.equal(options.body.allowCredentials[0].id, 'abc');
    const noChallenge = await bound.post('/webauthn/login/verify', { student_id: '6610301001', response: { id: 'abc' } });
    assert.equal(noChallenge.body.error, 'CHALLENGE_EXPIRED');
});
