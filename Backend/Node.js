const express = require('express');
const path = require('node:path');

const frontendPath = path.join(__dirname, '..', 'Frontend');
const sessionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createApp(pool) {
    const app = express();

    app.use(express.json({ limit: '16kb' }));

    app.get('/api/health', async (req, res, next) => {
        try {
            const result = await pool.query(`
                SELECT
                    to_regprocedure('point_in_geofence(geometry,geometry)') IS NOT NULL
                        AS geofence_function_available,
                    to_regclass('geofence_config') IS NOT NULL
                        AS default_geofence_table_available
            `);
            if (!result.rows[0].geofence_function_available
                || !result.rows[0].default_geofence_table_available) {
                return res.status(503).json({ status: 'unavailable', reason: 'geofence_schema_missing' });
            }
            const config = await pool.query(
                'SELECT EXISTS (SELECT 1 FROM geofence_config WHERE config_id = 1) AS available'
            );
            if (!config.rows[0].available) {
                return res.status(503).json({ status: 'unavailable', reason: 'default_geofence_missing' });
            }
            return res.json({ status: 'ok', database: 'connected', geofence: 'available' });
        } catch (error) {
            return next(error);
        }
    });

    app.post('/api/geofence/check', async (req, res, next) => {
        const { session_id: sessionId, latitude, longitude } = req.body || {};
        if (sessionId != null && (typeof sessionId !== 'string' || !sessionIdPattern.test(sessionId))) {
            return res.status(400).json({ error: 'INVALID_SESSION_ID' });
        }
        if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
            return res.status(400).json({ error: 'INVALID_LATITUDE' });
        }
        if (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
            return res.status(400).json({ error: 'INVALID_LONGITUDE' });
        }

        try {
            const result = await pool.query(
                `WITH input AS (
                    SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326) AS point
                ),
                geofences AS (
                    SELECT session_id, geofence_polygon,
                        valid_time_range @> NOW() AS active, 'SESSION'::text AS source
                    FROM attendance_session
                    WHERE session_id = $3::uuid
                    UNION ALL
                    SELECT NULL::uuid, geofence_polygon, TRUE, 'DEFAULT'::text
                    FROM geofence_config
                    WHERE $3::uuid IS NULL AND config_id = 1
                ),
                classified AS (
                    SELECT geofences.session_id, geofences.geofence_polygon,
                        geofences.active, geofences.source, input.point,
                        point_in_geofence(input.point, geofences.geofence_polygon) AS inside
                    FROM geofences CROSS JOIN input
                )
                SELECT session_id, active, source, inside,
                    CASE WHEN inside THEN NULL
                        ELSE ST_Distance(point::geography, ST_Boundary(geofence_polygon)::geography)
                    END AS distance_meters
                FROM classified`,
                [longitude, latitude, sessionId || null]
            );

            if (result.rowCount === 0) {
                return sessionId
                    ? res.status(404).json({ error: 'SESSION_NOT_FOUND' })
                    : res.status(503).json({ error: 'DEFAULT_GEOFENCE_NOT_CONFIGURED' });
            }
            if (!result.rows[0].active) {
                return res.status(410).json({ error: 'SESSION_NOT_ACTIVE' });
            }

            return res.json({
                session_id: result.rows[0].session_id,
                source: result.rows[0].source,
                inside: result.rows[0].inside,
                status: result.rows[0].inside ? 'INSIDE' : 'OUTSIDE',
                distance_meters: result.rows[0].distance_meters
            });
        } catch (error) {
            return next(error);
        }
    });

    app.use('/api', (req, res) => {
        res.status(404).json({ error: 'API_ROUTE_NOT_FOUND' });
    });

    app.use(express.static(frontendPath, {
        setHeaders: (res, filePath) => {
            if (filePath.endsWith('sw.js')) {
                res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
            }
        }
    }));

    app.use((error, req, res, next) => {
        if (res.headersSent) {
            return next(error);
        }
        if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
            return res.status(400).json({ error: 'INVALID_JSON' });
        }
        if (error.type === 'entity.too.large') {
            return res.status(413).json({ error: 'REQUEST_TOO_LARGE' });
        }
        console.error('Request failed:', error);
        return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    });

    return app;
}

if (require.main === module) {
    const pool = require('./database');
    const port = Number(process.env.PORT || 3000);
    const app = createApp(pool);
    const server = app.listen(port, '0.0.0.0', () => {
        console.log(`API and frontend listening on port ${port}`);
    });

    async function shutdown() {
        server.close();
        await pool.end();
    }

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

module.exports = { createApp };
