const express = require('express');
const { readSession } = require('./auth');

const sessionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const LIVE_MAX_ELAPSED_MS = 2 * 60 * 1000;
const MAX_ELAPSED_MS = 7 * 24 * 60 * 60 * 1000;
const SYNC_WINDOW_HOURS = 24;

const inRange = (value, min, max) => typeof value === 'number' && value >= min && value <= max;

function createAttendanceRouter({ pool, redis }) {
    const router = express.Router();

    // elapsed_ms is the age of the scan on the student's own clock, so a wrong device clock does not matter.
    // A student can fake it, so only a fresh scan inside the area of a session that is open right now
    // becomes PASSED; a late or outside scan is FLAGGED for review, not refused.
    router.post('/', async (req, res, next) => {
        const {
            student_id: studentId, session_id: sessionId, latitude, longitude, elapsed_ms: elapsedMs
        } = req.body || {};
        if (typeof sessionId !== 'string' || !sessionIdPattern.test(sessionId)) {
            return res.status(400).json({ error: 'INVALID_SESSION_ID' });
        }
        if (!inRange(latitude, -90, 90)) {
            return res.status(400).json({ error: 'INVALID_LATITUDE' });
        }
        if (!inRange(longitude, -180, 180)) {
            return res.status(400).json({ error: 'INVALID_LONGITUDE' });
        }
        if (!inRange(elapsedMs, 0, MAX_ELAPSED_MS)) {
            return res.status(400).json({ error: 'INVALID_ELAPSED_MS' });
        }

        try {
            const login = await readSession({ pool, redis }, req);
            if (!login) {
                return res.status(401).json({ error: 'LOGIN_REQUIRED' });
            }
            // A shared phone may hold another student's queued scans.
            if (login.studentId !== studentId) {
                return res.status(403).json({ error: 'STUDENT_MISMATCH' });
            }

            const found = await pool.query(
                `WITH scan AS (
                    SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326) AS point,
                        NOW() - $4::double precision * INTERVAL '1 millisecond' AS scanned_at
                )
                SELECT s.course_id, l.status AS existing_status, scan.scanned_at,
                    s.valid_time_range @> NOW() AS active,
                    s.valid_time_range @> scan.scanned_at AS scanned_in_time,
                    COALESCE(upper(s.valid_time_range) + $6::int * INTERVAL '1 hour' >= NOW(), TRUE) AS sync_open,
                    point_in_geofence(scan.point, s.geofence_polygon) AS inside
                FROM attendance_session s
                CROSS JOIN scan
                LEFT JOIN attendance_log l ON l.session_id = s.session_id AND l.external_user_id = $5
                WHERE s.session_id = $3::uuid`,
                [longitude, latitude, sessionId, elapsedMs, studentId, SYNC_WINDOW_HOURS]
            );
            const session = found.rows[0];
            if (!session) {
                return res.status(404).json({ error: 'SESSION_NOT_FOUND' });
            }
            const status = session.active && session.scanned_in_time && session.inside
                && elapsedMs <= LIVE_MAX_ELAPSED_MS ? 'PASSED' : 'FLAGGED';
            // Checked first: a retry after a lost response must succeed even when the sync window has closed.
            // A student flagged outside may still walk in and scan again to pass.
            const canUpgrade = session.existing_status === 'FLAGGED' && status === 'PASSED';
            if (session.existing_status && !canUpgrade) {
                return res.json({ status: session.existing_status, course_id: session.course_id, duplicate: true });
            }
            if (!session.scanned_in_time || !session.sync_open) {
                return res.status(410).json({ error: 'SESSION_NOT_ACTIVE' });
            }

            // shortcut: fixed risk scores, replace when the Trust Score model exists.
            const riskScore = status === 'PASSED' ? 0 : 0.5;
            const inserted = await pool.query(
                `INSERT INTO attendance_log
                    (session_id, external_user_id, provider_used, risk_score, location_point, status, scanned_at)
                 VALUES ($1, $2, 'WEBAUTHN', $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), $6, $7)
                 ON CONFLICT (session_id, external_user_id) DO UPDATE
                    SET risk_score = EXCLUDED.risk_score, location_point = EXCLUDED.location_point,
                        status = EXCLUDED.status, scanned_at = EXCLUDED.scanned_at, created_at = NOW()
                    WHERE attendance_log.status = 'FLAGGED' AND attendance_log.override_by IS NULL
                        AND EXCLUDED.status = 'PASSED'
                 RETURNING status`,
                [sessionId, studentId, riskScore, longitude, latitude, status, session.scanned_at]
            );
            if (inserted.rowCount === 0) {
                const existing = await pool.query(
                    'SELECT status FROM attendance_log WHERE session_id = $1 AND external_user_id = $2',
                    [sessionId, studentId]
                );
                return res.json({
                    status: existing.rows[0].status, course_id: session.course_id, duplicate: true
                });
            }
            return res.status(201).json({ status, course_id: session.course_id, duplicate: false });
        } catch (error) {
            return next(error);
        }
    });

    return router;
}

module.exports = { createAttendanceRouter };
