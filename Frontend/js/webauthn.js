// js/webauthn.js - WebAuthn API for Biometrics (Fingerprint / FaceID)

const STUDENT_ID_KEY = 'cams_student_id';
const STUDENT_EMAIL_DOMAIN = 'cdti.ac.th';

const AUTH_ERROR_MESSAGES = {
    INVALID_STUDENT_ID: 'รหัสนักศึกษาต้องเป็นตัวเลข 10 หลัก',
    OTP_COOLDOWN: 'ขอ OTP ได้ทุก 60 วินาที กรุณารอสักครู่',
    TOO_MANY_REQUESTS: 'ขอ OTP บ่อยเกินไป กรุณาลองใหม่ภายหลัง',
    EMAIL_SEND_FAILED: 'ส่งอีเมลไม่สำเร็จ กรุณาลองใหม่',
    INVALID_OTP_FORMAT: 'OTP ต้องเป็นตัวเลข 6 หลัก',
    OTP_EXPIRED: 'OTP หมดอายุ กรุณาขอรหัสใหม่',
    OTP_INCORRECT: 'OTP ไม่ถูกต้อง',
    OTP_TOO_MANY_ATTEMPTS: 'กรอก OTP ผิดเกินกำหนด กรุณาขอรหัสใหม่',
    ENROLLMENT_EXPIRED: 'หมดเวลาลงทะเบียน กรุณาขอ OTP ใหม่',
    DEVICE_ALREADY_BOUND: 'รหัสนักศึกษานี้ผูกกับอุปกรณ์อื่นแล้ว',
    DEVICE_NOT_BOUND: 'ยังไม่ได้ผูกอุปกรณ์นี้ กรุณาลงทะเบียนด้วย OTP',
    CHALLENGE_EXPIRED: 'หมดเวลายืนยัน กรุณาลองใหม่',
    WEBAUTHN_VERIFICATION_FAILED: 'เซิร์ฟเวอร์ตรวจสอบลายนิ้วมือ/ใบหน้าไม่ผ่าน'
};

async function postAuth(path, body) {
    const response = await fetch(`/api/auth${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
    }).catch(() => {
        throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต');
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(AUTH_ERROR_MESSAGES[data.error] || data.error || `HTTP ${response.status}`);
        error.code = data.error;
        throw error;
    }
    return data;
}

class BiometricAuth {
    constructor() {
        this.isSupported = window.PublicKeyCredential !== undefined;
    }

    // ตรวจสอบว่าเครื่อง/เบราว์เซอร์รองรับสแกนนิ้ว/ใบหน้าหรือไม่
    async checkSupport() {
        if (!this.isSupported) return false;
        try {
            return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        } catch (e) {
            return false;
        }
    }

    async verifyFaceBiometrics() {
        return this.verifyBiometrics();
    }

    getStudentId() {
        return localStorage.getItem(STUDENT_ID_KEY);
    }

    hasRegisteredCredential() {
        return Boolean(this.getStudentId());
    }

    requestOtp(studentId) {
        return postAuth('/otp/request', { student_id: studentId });
    }

    async verifyOtp(studentId, code) {
        const { enrollment_token: enrollmentToken } = await postAuth('/otp/verify', { student_id: studentId, code });
        return enrollmentToken;
    }

    // ลงทะเบียน Biometrics: server สร้าง challenge และตรวจ attestation ก่อนผูกอุปกรณ์
    async registerBiometrics(enrollmentToken) {
        if (!await this.checkSupport()) {
            throw new Error('อุปกรณ์ของคุณไม่รองรับการสแกนนิ้วมือหรือใบหน้า (Platform Authenticator)');
        }
        const optionsJSON = await postAuth('/webauthn/register/options', { enrollment_token: enrollmentToken });
        const response = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON });
        const result = await postAuth('/webauthn/register/verify', { enrollment_token: enrollmentToken, response });
        localStorage.setItem(STUDENT_ID_KEY, result.student_id);
        return result;
    }

    // ยืนยันตัวตนด้วย Biometrics: server ตรวจ signature กับ public key ที่ผูกไว้
    async login(studentId) {
        const optionsJSON = await postAuth('/webauthn/login/options', { student_id: studentId });
        const response = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON });
        return postAuth('/webauthn/login/verify', { student_id: studentId, response });
    }

    async verifyBiometrics() {
        if (!await this.checkSupport()) {
            throw new Error('อุปกรณ์ของคุณไม่รองรับการสแกนนิ้วมือหรือใบหน้า');
        }
        const studentId = this.getStudentId();
        if (!studentId) {
            const error = new Error(AUTH_ERROR_MESSAGES.DEVICE_NOT_BOUND);
            error.code = 'DEVICE_NOT_BOUND';
            throw error;
        }
        try {
            return await this.login(studentId);
        } catch (error) {
            if (error.code === 'DEVICE_NOT_BOUND') {
                localStorage.removeItem(STUDENT_ID_KEY);
            }
            throw error;
        }
    }
}

class FaceScanner {
    constructor() {
        this.stream = null;
        this.faceDetector = null;

        if ('FaceDetector' in window) {
            this.faceDetector = new FaceDetector({
                fastMode: true,
                locateAt: 'largest-area'
            });
        }
    }

    async openCamera() {
        const video = document.getElementById('face-video');
        if (!video) {
            throw new Error('ไม่พบองค์ประกอบกล้องหน้าของแอป');
        }

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('เบราว์เซอร์นี้ไม่รองรับกล้องของโทรศัพท์');
        }

        if (!this.faceDetector) {
            throw new Error('เบราว์เซอร์นี้ยังไม่รองรับ FaceDetector API');
        }

        this.stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'user',
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: false
        });

        video.srcObject = this.stream;
        video.muted = true;
        video.playsInline = true;
        await video.play();
        video.style.display = 'block';

        return video;
    }

    stopCamera() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }

        const video = document.getElementById('face-video');
        if (video) {
            video.srcObject = null;
            video.style.display = 'none';
        }
    }

    async scanFace(studentId) {
        const video = document.getElementById('face-video');
        const resultBox = document.getElementById('face-result');

        if (!video) {
            throw new Error('ไม่พบกล้องหน้าในหน้าเว็บ');
        }

        if (!this.stream) {
            await this.openCamera();
        }

        const faces = await this.faceDetector.detect(video);

        if (!faces || faces.length === 0) {
            const message = 'ไม่พบใบหน้าในภาพ กรุณาจัดตำแหน่งหน้าให้ชัดเจน';
            if (resultBox) resultBox.innerHTML = message;
            return { success: false, message };
        }

        const face = faces[0];
        const box = face.boundingBox;
        const data = {
            studentId,
            capturedAt: new Date().toISOString(),
            faceCount: faces.length,
            width: Math.round(box.width),
            height: Math.round(box.height),
            x: Math.round(box.x),
            y: Math.round(box.y),
            pitch: face.pitch !== undefined ? Number(face.pitch.toFixed(2)) : null,
            roll: face.roll !== undefined ? Number(face.roll.toFixed(2)) : null,
            yaw: face.yaw !== undefined ? Number(face.yaw.toFixed(2)) : null,
            blur: face.blur !== undefined ? Number(face.blur.toFixed(2)) : null
        };

        localStorage.setItem(`face_scan_${studentId}`, JSON.stringify(data));

        const summary = `พบใบหน้า ${faces.length} รายการ | ขนาดภาพ ${(box.width)} x ${(box.height)} | มุม yaw=${data.yaw ?? '-'} | roll=${data.roll ?? '-'} | blur=${data.blur ?? '-'}`;
        if (resultBox) {
            resultBox.innerHTML = `<strong>ข้อมูลใบหน้าที่ดึงจากโทรศัพท์:</strong><br>${summary}`;
        }

        return { success: true, message: 'สแกนหน้าเรียบร้อยแล้ว', data };
    }
}

const biometricAuth = new BiometricAuth();
const faceScanner = new FaceScanner();

async function startFaceCamera() {
    const statusText = document.getElementById('biometric-status');
    const resultBox = document.getElementById('face-result');

    try {
        if (statusText) statusText.textContent = 'กำลังเรียกใช้ Face ID / Face Unlock ของระบบปฏิบัติการ...';
        await biometricAuth.verifyFaceBiometrics();
        if (resultBox) {
            resultBox.innerHTML = '<strong>ยืนยันใบหน้าโดยระบบปฏิบัติการมือถือตรงตาม Face ID / Face Unlock แล้ว</strong><br>ใช้สิทธิ์สแกนใบหน้าจาก OS ของอุปกรณ์';
        }
        if (statusText) statusText.textContent = 'ยืนยันใบหน้าโดยระบบปฏิบัติการสำเร็จ';
    } catch (err) {
        if (statusText) statusText.textContent = 'ไม่สามารถเรียกใช้ Face ID / Face Unlock ได้';
        if (resultBox) resultBox.innerHTML = `ข้อผิดพลาด: ${err.message}`;
        alert(err.message);
    }
}

async function handleFaceScan() {
    const statusText = document.getElementById('biometric-status');
    const resultBox = document.getElementById('face-result');

    try {
        if (statusText) statusText.textContent = 'กำลังเรียกใช้ Face ID / Face Unlock...';
        await biometricAuth.verifyFaceBiometrics();
        if (resultBox) {
            resultBox.innerHTML = '<strong>สแกนใบหน้าเรียบร้อยแล้ว</strong><br>ใช้งาน Face ID / Face Unlock จากระบบปฏิบัติการมือถือ';
        }
        if (statusText) {
            statusText.textContent = 'สแกนใบหน้าโดยระบบปฏิบัติการสำเร็จ';
        }
    } catch (err) {
        if (statusText) statusText.textContent = 'ไม่สามารถสแกนใบหน้าได้';
        if (resultBox) resultBox.innerHTML = `ข้อผิดพลาด: ${err.message}`;
        alert(err.message);
    }
}

let loginStudentId = null;
// Kept after a cancelled scan so "Continue" can retry without a new OTP (server token lives 10 min).
let pendingEnrollmentToken = null;

function setLoginStatus(message) {
    document.getElementById('login-status').textContent = message;
}

// Accepts "6610301000@cdti.ac.th" or the bare 10-digit student ID.
function parseStudentEmail(value) {
    const match = value.trim().toLowerCase().match(/^(\d{10})(@cdti\.ac\.th)?$/);
    return match ? match[1] : null;
}

function showLoginEmailStep() {
    document.getElementById('login-otp-step').hidden = true;
    document.getElementById('login-email-step').hidden = false;
    document.getElementById('login-otp').value = '';
    pendingEnrollmentToken = null;
    setLoginStatus('');
}

async function handleLoginEmail(event) {
    event.preventDefault();
    const studentId = parseStudentEmail(document.getElementById('login-email').value);
    if (!studentId) {
        setLoginStatus(`กรุณาใช้อีเมลสถาบัน เช่น 6610301000@${STUDENT_EMAIL_DOMAIN}`);
        return;
    }
    try {
        setLoginStatus('กำลังส่ง OTP...');
        const { email } = await biometricAuth.requestOtp(studentId);
        loginStudentId = studentId;
        pendingEnrollmentToken = null;
        document.getElementById('login-otp-email').textContent = email;
        document.getElementById('login-email-step').hidden = true;
        document.getElementById('login-otp-step').hidden = false;
        document.getElementById('login-otp').focus();
        setLoginStatus('');
    } catch (err) {
        setLoginStatus(err.message);
    }
}

async function handleLoginOtp(event) {
    event.preventDefault();
    const code = document.getElementById('login-otp').value.trim();
    try {
        if (!pendingEnrollmentToken) {
            setLoginStatus('กำลังตรวจสอบ OTP...');
            pendingEnrollmentToken = await biometricAuth.verifyOtp(loginStudentId, code);
        }
        const enrollmentToken = pendingEnrollmentToken;
        setLoginStatus('สแกนลายนิ้วมือ/ใบหน้าเพื่อผูกอุปกรณ์นี้');
        try {
            await biometricAuth.registerBiometrics(enrollmentToken);
        } catch (err) {
            if (err.code !== 'DEVICE_ALREADY_BOUND') throw err;
            // Already bound: works only if the bound credential lives on this device (e.g. after logout).
            setLoginStatus('บัญชีนี้ผูกอุปกรณ์แล้ว สแกนเพื่อยืนยันว่าเป็นเครื่องเดิม');
            try {
                await biometricAuth.login(loginStudentId);
            } catch (loginErr) {
                if (loginErr.name !== 'NotAllowedError') throw loginErr;
                throw new Error('บัญชีนี้ผูกกับอุปกรณ์อื่นแล้ว ใช้ได้ 1 คน 1 เครื่อง');
            }
            localStorage.setItem(STUDENT_ID_KEY, loginStudentId);
        }
        enterApp();
    } catch (err) {
        if (err.code === 'ENROLLMENT_EXPIRED') pendingEnrollmentToken = null;
        setLoginStatus(err.name === 'NotAllowedError' && pendingEnrollmentToken
            ? 'การสแกนถูกยกเลิกหรือหมดเวลา กด Continue เพื่อสแกนอีกครั้ง'
            : err.message);
    }
}

function enterApp() {
    document.body.classList.remove('logged-out');
    document.getElementById('login-email').value = '';
    showLoginEmailStep();
    localStorage.removeItem(LOGOUT_PENDING_KEY);
    syncAttendance();
}

async function logout() {
    const pending = (await getPendingScans().catch(() => [])).length;
    const warning = pending ? `มี ${pending} รายการยังไม่ได้ส่ง จะส่งเมื่อกลับมาเข้าสู่ระบบด้วยบัญชีนี้ในเครื่องนี้\n` : '';
    if (!confirm(`${warning}ต้องการออกจากระบบใช่หรือไม่?`)) return;
    localStorage.removeItem(STUDENT_ID_KEY);
    localStorage.setItem(LOGOUT_PENDING_KEY, '1');
    syncAttendance();
    closeAppPage();
    document.body.classList.add('logged-out');
}

async function handleBiometricVerify() {
    const statusText = document.getElementById('biometric-status');

    try {
        if (statusText) statusText.textContent = 'กำลังรอการยืนยันลายนิ้วมือ/ใบหน้า...';
        await biometricAuth.verifyBiometrics();
        if (statusText) statusText.textContent = 'ยืนยันตัวตนสำเร็จ!';
        syncAttendance();
        alert('สแกนลายนิ้วมือผ่านเรียบร้อย! เข้าสู่ระบบสำเร็จ');
    } catch (err) {
        if (statusText) statusText.textContent = 'ยืนยันตัวตนไม่สำเร็จ';
        if (err.code === 'DEVICE_NOT_BOUND') {
            document.body.classList.add('logged-out');
            return;
        }
        alert(err.name === 'NotAllowedError' ? 'การสแกนถูกยกเลิก หรือหมดเวลา' : `ยืนยันตัวตนล้มเหลว: ${err.message}`);
    }
}
