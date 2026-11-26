const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const { createApp } = require('./Node');
const { createAuthConfig, hashToken } = require('./auth');

const studentId = '6610301000';
const token = 'test-token';
const scan = {
    student_id: studentId,
    session_id: '00000000-0000-4000-8000-000000000001',
    latitude: 13.7672,
    longitude: 100.5142,
    elapsed_ms: 1000
};
const openSession = {
    course_id: 'CS101', existing_status: null, scanned_at: new Date(),
    active: true, scanned_in_time: true, sync_open: true, inside: true
};
const servers = [];

afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))));
});

async function submit({ session = openSession, body = {}, cookie = `cams_session=${token}`, deviceActive = true,
    conflict = null, path = '/api/attendance' } = {}) {
    const store = new Map([[`session:${hashToken(token)}`, JSON.stringify({ studentId, credentialId: 'abc' })]]);
    const inserts = [];
    const pool = {
        query: async (sql, params) => {
            if (sql.includes('FROM user_device')) return { rowCount: deviceActive ? 1 : 0, rows: [] };
            if (sql.includes('INSERT INTO attendance_log')) {
                inserts.push(params);
                return { rowCount: conflict ? 0 : 1, rows: [] };
            }
            if (sql.startsWith('SELECT status')) return { rowCount: 1, rows: [{ status: conflict }] };
            return { rowCount: session ? 1 : 0, rows: session ? [session] : [] };
        }
    };
    const redis = { get: async key => store.get(key) ?? null, del: async key => store.delete(key) };
    const server = createApp(pool, { redis, sendMail: async () => {}, config: createAuthConfig({}) }).listen(0);
    servers.push(server);
    await new Promise(resolve => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ ...scan, ...body })
    });
    return { status: response.status, body: await response.json(), inserts, store };
}

test('a fresh scan in an open session passes', async () => {
    const res = await submit();
    assert.equal(res.status, 201);
    assert.deepEqual(res.body, { status: 'PASSED', course_id: 'CS101', duplicate: false });
    assert.equal(res.inserts.length, 1);
});

test('a late sync is flagged, whether or not the session is still open', async () => {
    assert.equal((await submit({ body: { elapsed_ms: 121_000 } })).body.status, 'FLAGGED');
    assert.equal((await submit({ session: { ...openSession, active: false } })).body.status, 'FLAGGED');
});

test('a scan outside the area is flagged, not refused', async () => {
    const res = await submit({ session: { ...openSession, inside: false } });
    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'FLAGGED');
    assert.equal(res.inserts.length, 1);
});

test('only a fresh scan inside the area upgrades a flagged result', async () => {
    const flagged = { ...openSession, existing_status: 'FLAGGED' };
    const upgraded = await submit({ session: flagged });
    assert.equal(upgraded.body.status, 'PASSED');
    assert.equal(upgraded.inserts.length, 1);
    for (const change of [{ inside: false }, { active: false }]) {
        const res = await submit({ session: { ...flagged, ...change } });
        assert.equal(res.body.status, 'FLAGGED');
        assert.equal(res.inserts.length, 0);
    }
});

test('scans outside the session time or sync window are not logged', async () => {
    const rejected = [
        [{ scanned_in_time: false }, 410, 'SESSION_NOT_ACTIVE'],
        [{ sync_open: false }, 410, 'SESSION_NOT_ACTIVE']
    ];
    for (const [change, status, error] of rejected) {
        const res = await submit({ session: { ...openSession, ...change } });
        assert.equal(res.status, status);
        assert.equal(res.body.error, error);
        assert.equal(res.inserts.length, 0);
    }
    assert.equal((await submit({ session: null })).body.error, 'SESSION_NOT_FOUND');
});

test('resending returns the logged result, even after the sync window', async () => {
    const res = await submit({ session: { ...openSession, existing_status: 'PASSED', sync_open: false } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: 'PASSED', course_id: 'CS101', duplicate: true });
    assert.equal((await submit({ conflict: 'FLAGGED' })).body.status, 'FLAGGED');
});

test('needs a login for the same student on a device that is still bound', async () => {
    assert.equal((await submit({ cookie: '' })).body.error, 'LOGIN_REQUIRED');
    assert.equal((await submit({ cookie: 'cams_session=wrong' })).body.error, 'LOGIN_REQUIRED');
    assert.equal((await submit({ deviceActive: false })).body.error, 'LOGIN_REQUIRED');
    assert.equal((await submit({ body: { student_id: '6610301999' } })).body.error, 'STUDENT_MISMATCH');
});

test('rejects malformed scans', async () => {
    for (const body of [{ session_id: 'x' }, { latitude: 91 }, { longitude: '100' }, { elapsed_ms: -1 }]) {
        assert.equal((await submit({ body })).status, 400);
    }
});

test('logout ends the session', async () => {
    const res = await submit({ path: '/api/auth/logout' });
    assert.equal(res.status, 200);
    assert.equal(res.store.size, 0);
});
