const crypto = require('node:crypto');
const express = require('express');
const {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse
} = require('@simplewebauthn/server');

const studentIdPattern = /^\d{10}$/;
const otpPattern = /^\d{6}$/;

const OTP_TTL_SECONDS = 300;
const OTP_MAX_TRIES = 5;
const OTP_RESEND_COOLDOWN_SECONDS = 60;
const OTP_MAX_PER_IP_PER_HOUR = 20;
const ENROLL_TTL_SECONDS = 600;
const CHALLENGE_TTL_SECONDS = 300;
// Long enough to sync scans queued while offline without a new biometric scan.
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const SESSION_COOKIE = 'cams_session';

function createAuthConfig(env) {
    if (env.NODE_ENV === 'production' && !env.OTP_PEPPER) {
        throw new Error('OTP_PEPPER must be set in production');
    }
    return {
        rpID: env.RP_ID || 'localhost',
        rpName: env.RP_NAME || 'CAMS Attendance',
        origins: (env.WEBAUTHN_ORIGIN || 'http://localhost:3000').split(',').map(s => s.trim()),
        emailDomain: env.STUDENT_EMAIL_DOMAIN || 'cdti.ac.th',
        otpPepper: env.OTP_PEPPER || 'dev-only-pepper',
        secureCookies: env.NODE_ENV === 'production'
    };
}

function hashOtp(pepper, studentId, code) {
    return crypto.createHmac('sha256', pepper).update(`${studentId}:${code}`).digest();
}

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function sessionKey(req) {
    const prefix = `${SESSION_COOKIE}=`;
    const cookie = (req.headers.cookie || '').split('; ').find(part => part.startsWith(prefix));
    return cookie ? `session:${hashToken(cookie.slice(prefix.length))}` : null;
}

// Returns { studentId, credentialId }, or null when there is no login or its device was revoked.
async function readSession({ pool, redis }, req) {
    const key = sessionKey(req);
    const stored = key && await redis.get(key);
    if (!stored) return null;
    const session = JSON.parse(stored);
    const device = await pool.query(
        `SELECT 1 FROM user_device
         WHERE external_user_id = $1 AND credential_id = $2 AND revoked_at IS NULL`,
        [session.studentId, session.credentialId]
    );
    return device.rowCount ? session : null;
}

function createAuthRouter({ pool, redis, sendMail, config }) {
    const router = express.Router();

    const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: config.secureCookies, path: '/api' };

    async function startSession(res, studentId, credentialId) {
        const token = crypto.randomBytes(32).toString('base64url');
        await redis.set(`session:${hashToken(token)}`, JSON.stringify({ studentId, credentialId }),
            'EX', SESSION_TTL_SECONDS);
        res.cookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: SESSION_TTL_SECONDS * 1000 });
    }

    async function getActiveDevice(studentId) {
        const result = await pool.query(
            `SELECT credential_id, public_key, sign_count, transports
             FROM user_device
             WHERE external_user_id = $1 AND revoked_at IS NULL`,
            [studentId]
        );
        return result.rows[0] || null;
    }

    router.post('/otp/request', async (req, res, next) => {
        const studentId = req.body?.student_id;
        if (typeof studentId !== 'string' || !studentIdPattern.test(studentId)) {
            return res.status(400).json({ error: 'INVALID_STUDENT_ID' });
        }
        try {
            const ipKey = `otp:ip:${req.ip}`;
            const ipCount = await redis.incr(ipKey);
            if (ipCount === 1) await redis.expire(ipKey, 3600);
            if (ipCount > OTP_MAX_PER_IP_PER_HOUR) {
                return res.status(429).json({ error: 'TOO_MANY_REQUESTS' });
            }

            const cooldownKey = `otp:cool:${studentId}`;
            const allowed = await redis.set(cooldownKey, '1', 'EX', OTP_RESEND_COOLDOWN_SECONDS, 'NX');
            if (!allowed) {
                return res.status(429).json({ error: 'OTP_COOLDOWN', retry_after: OTP_RESEND_COOLDOWN_SECONDS });
            }

            const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
            const email = `${studentId}@${config.emailDomain}`;
            await redis.set(`otp:${studentId}`, hashOtp(config.otpPepper, studentId, code).toString('hex'),
                'EX', OTP_TTL_SECONDS);
            await redis.del(`otp:tries:${studentId}`);

            try {
                await sendMail({
                    to: email,
                    subject: 'รหัส OTP สำหรับลงทะเบียน CAMS',
                    text: `รหัส OTP ของคุณคือ ${code}\nรหัสนี้หมดอายุใน 5 นาที ห้ามบอกรหัสนี้กับผู้อื่น`
                });
            } catch (error) {
                console.error('OTP email failed:', error.message);
                await redis.del(cooldownKey, `otp:${studentId}`);
                return res.status(502).json({ error: 'EMAIL_SEND_FAILED' });
            }

            return res.status(202).json({ email, expires_in: OTP_TTL_SECONDS });
        } catch (error) {
            return next(error);
        }
    });

    router.post('/otp/verify', async (req, res, next) => {
        const { student_id: studentId, code } = req.body || {};
        if (typeof studentId !== 'string' || !studentIdPattern.test(studentId)) {
            return res.status(400).json({ error: 'INVALID_STUDENT_ID' });
        }
        if (typeof code !== 'string' || !otpPattern.test(code)) {
            return res.status(400).json({ error: 'INVALID_OTP_FORMAT' });
        }
        try {
            const otpKey = `otp:${studentId}`;
            const triesKey = `otp:tries:${studentId}`;
            const stored = await redis.get(otpKey);
            if (!stored) {
                return res.status(400).json({ error: 'OTP_EXPIRED' });
            }
            const tries = await redis.incr(triesKey);
            if (tries === 1) await redis.expire(triesKey, OTP_TTL_SECONDS);
            if (tries > OTP_MAX_TRIES) {
                await redis.del(otpKey, triesKey);
                return res.status(429).json({ error: 'OTP_TOO_MANY_ATTEMPTS' });
            }
            const expected = Buffer.from(stored, 'hex');
            const actual = hashOtp(config.otpPepper, studentId, code);
            if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
                return res.status(400).json({ error: 'OTP_INCORRECT', attempts_left: OTP_MAX_TRIES - tries });
            }

            await redis.del(otpKey, triesKey);
            const enrollmentToken = crypto.randomBytes(32).toString('base64url');
            await redis.set(`enroll:${enrollmentToken}`, studentId, 'EX', ENROLL_TTL_SECONDS);
            return res.json({ enrollment_token: enrollmentToken, expires_in: ENROLL_TTL_SECONDS });
        } catch (error) {
            return next(error);
        }
    });

    router.post('/webauthn/register/options', async (req, res, next) => {
        const token = req.body?.enrollment_token;
        if (typeof token !== 'string' || token.length > 100) {
            return res.status(400).json({ error: 'INVALID_ENROLLMENT_TOKEN' });
        }
        try {
            const studentId = await redis.get(`enroll:${token}`);
            if (!studentId) {
                return res.status(401).json({ error: 'ENROLLMENT_EXPIRED' });
            }
            if (await getActiveDevice(studentId)) {
                return res.status(409).json({ error: 'DEVICE_ALREADY_BOUND' });
            }
            const options = await generateRegistrationOptions({
                rpName: config.rpName,
                rpID: config.rpID,
                userName: studentId,
                userDisplayName: `Student: ${studentId}`,
                attestationType: 'none',
                authenticatorSelection: {
                    authenticatorAttachment: 'platform',
                    residentKey: 'preferred',
                    userVerification: 'required'
                }
            });
            await redis.set(`reg:${token}`, options.challenge, 'EX', CHALLENGE_TTL_SECONDS);
            return res.json(options);
        } catch (error) {
            return next(error);
        }
    });

    router.post('/webauthn/register/verify', async (req, res, next) => {
        const { enrollment_token: token, response } = req.body || {};
        if (typeof token !== 'string' || token.length > 100 || !response || typeof response !== 'object') {
            return res.status(400).json({ error: 'INVALID_REQUEST' });
        }
        try {
            const expectedChallenge = await redis.getdel(`reg:${token}`);
            const studentId = await redis.get(`enroll:${token}`);
            if (!expectedChallenge || !studentId) {
                return res.status(401).json({ error: 'ENROLLMENT_EXPIRED' });
            }

            let verification;
            try {
                verification = await verifyRegistrationResponse({
                    response,
                    expectedChallenge,
                    expectedOrigin: config.origins,
                    expectedRPID: config.rpID,
                    requireUserVerification: true
                });
            } catch (error) {
                return res.status(400).json({ error: 'WEBAUTHN_VERIFICATION_FAILED', detail: error.message });
            }
            if (!verification.verified) {
                return res.status(400).json({ error: 'WEBAUTHN_VERIFICATION_FAILED' });
            }

            const { credential } = verification.registrationInfo;
            try {
                await pool.query(
                    `INSERT INTO user_device
                        (external_user_id, credential_id, public_key, sign_count, transports, last_ip)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [
                        studentId,
                        credential.id,
                        Buffer.from(credential.publicKey).toString('base64url'),
                        credential.counter,
                        credential.transports || null,
                        req.ip
                    ]
                );
            } catch (error) {
                if (error.code === '23505') {
                    return res.status(409).json({ error: 'DEVICE_ALREADY_BOUND' });
                }
                throw error;
            }
            await redis.del(`enroll:${token}`);
            await startSession(res, studentId, credential.id);
            return res.status(201).json({ verified: true, student_id: studentId });
        } catch (error) {
            return next(error);
        }
    });

    router.post('/webauthn/login/options', async (req, res, next) => {
        const studentId = req.body?.student_id;
        if (typeof studentId !== 'string' || !studentIdPattern.test(studentId)) {
            return res.status(400).json({ error: 'INVALID_STUDENT_ID' });
        }
        try {
            const device = await getActiveDevice(studentId);
            if (!device) {
                return res.status(404).json({ error: 'DEVICE_NOT_BOUND' });
            }
            const options = await generateAuthenticationOptions({
                rpID: config.rpID,
                allowCredentials: [{ id: device.credential_id, transports: device.transports || undefined }],
                userVerification: 'required'
            });
            await redis.set(`auth:${studentId}`, options.challenge, 'EX', CHALLENGE_TTL_SECONDS);
            return res.json(options);
        } catch (error) {
            return next(error);
        }
    });

    router.post('/webauthn/login/verify', async (req, res, next) => {
        const { student_id: studentId, response } = req.body || {};
        if (typeof studentId !== 'string' || !studentIdPattern.test(studentId)
            || !response || typeof response !== 'object') {
            return res.status(400).json({ error: 'INVALID_REQUEST' });
        }
        try {
            const expectedChallenge = await redis.getdel(`auth:${studentId}`);
            if (!expectedChallenge) {
                return res.status(401).json({ error: 'CHALLENGE_EXPIRED' });
            }
            const device = await getActiveDevice(studentId);
            if (!device || device.credential_id !== response.id) {
                return res.status(401).json({ error: 'DEVICE_NOT_BOUND' });
            }

            let verification;
            try {
                verification = await verifyAuthenticationResponse({
                    response,
                    expectedChallenge,
                    expectedOrigin: config.origins,
                    expectedRPID: config.rpID,
                    credential: {
                        id: device.credential_id,
                        publicKey: Buffer.from(device.public_key, 'base64url'),
                        counter: Number(device.sign_count),
                        transports: device.transports || undefined
                    },
                    requireUserVerification: true
                });
            } catch (error) {
                return res.status(401).json({ error: 'WEBAUTHN_VERIFICATION_FAILED', detail: error.message });
            }
            if (!verification.verified) {
                return res.status(401).json({ error: 'WEBAUTHN_VERIFICATION_FAILED' });
            }

            await pool.query(
                `UPDATE user_device SET sign_count = $1, last_ip = $2
                 WHERE credential_id = $3 AND revoked_at IS NULL`,
                [verification.authenticationInfo.newCounter, req.ip, device.credential_id]
            );
            // Phase 3 issues access/refresh tokens here.
            await startSession(res, studentId, device.credential_id);
            return res.json({ verified: true, student_id: studentId });
        } catch (error) {
            return next(error);
        }
    });

    router.post('/logout', async (req, res, next) => {
        try {
            const key = sessionKey(req);
            if (key) await redis.del(key);
            res.clearCookie(SESSION_COOKIE, cookieOptions);
            return res.json({ logged_out: true });
        } catch (error) {
            return next(error);
        }
    });

    return router;
}

module.exports = { createAuthRouter, createAuthConfig, hashOtp, hashToken, readSession };
