const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const { createApp } = require('./Node');

const sessionId = '00000000-0000-4000-8000-000000000001';
const servers = [];

async function requestWithPool(pool, body, path = '/api/geofence/check') {
    const server = createApp(pool).listen(0);
    servers.push(server);
    await new Promise(resolve => server.once('listening', resolve));
    const requestOptions = body === undefined
        ? { redirect: 'manual' }
        : {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            redirect: 'manual'
        };
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, requestOptions);
    const responseBody = response.headers.get('content-type')?.includes('application/json')
        ? await response.json()
        : null;
    return { response, body: responseBody, server };
}

afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
    })));
});

test('returns the PostGIS inside result for an active session', async () => {
    const pool = {
        query: async () => ({
            rowCount: 1,
            rows: [{
                session_id: sessionId,
                source: 'SESSION',
                inside: true,
                active: true,
                distance_meters: null
            }]
        })
    };
    const { response, body } = await requestWithPool(pool, {
        session_id: sessionId,
        latitude: 13.7,
        longitude: 100.5
    });

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
        session_id: sessionId,
        source: 'SESSION',
        inside: true,
        status: 'INSIDE',
        distance_meters: null
    });
});

test('uses the default PostGIS geofence when no session QR was scanned', async () => {
    let queryParameters;
    const pool = {
        query: async (sql, parameters) => {
            queryParameters = parameters;
            return {
                rowCount: 1,
                rows: [{
                    session_id: null,
                    source: 'DEFAULT',
                    inside: false,
                    active: true,
                    distance_meters: 125.5
                }]
            };
        }
    };
    const { response, body } = await requestWithPool(pool, {
        latitude: 13.811899,
        longitude: 100.533605
    });

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
        session_id: null,
        source: 'DEFAULT',
        inside: false,
        status: 'OUTSIDE',
        distance_meters: 125.5
    });
    assert.equal(queryParameters[2], null);
});

test('rejects invalid coordinates before querying PostGIS', async () => {
    let queried = false;
    const pool = { query: async () => { queried = true; } };
    const { response, body } = await requestWithPool(pool, {
        session_id: sessionId,
        latitude: 91,
        longitude: 100.5
    });

    assert.equal(response.status, 400);
    assert.equal(body.error, 'INVALID_LATITUDE');
    assert.equal(queried, false);
});

test('reports unknown and inactive sessions distinctly', async () => {
    const missing = await requestWithPool({ query: async () => ({ rowCount: 0, rows: [] }) }, {
        session_id: sessionId,
        latitude: 13.7,
        longitude: 100.5
    });
    assert.equal(missing.response.status, 404);
    assert.equal(missing.body.error, 'SESSION_NOT_FOUND');

    const inactive = await requestWithPool({
        query: async () => ({
            rowCount: 1,
            rows: [{
                session_id: sessionId,
                source: 'SESSION',
                inside: false,
                active: false,
                distance_meters: 1
            }]
        })
    }, {
        session_id: sessionId,
        latitude: 13.7,
        longitude: 100.5
    });
    assert.equal(inactive.response.status, 410);
    assert.equal(inactive.body.error, 'SESSION_NOT_ACTIVE');
});

