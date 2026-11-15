// js/webauthn.js - WebAuthn API for Biometrics (Fingerprint / FaceID)

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

    // ยืนยันตัวตนด้วย Biometrics (Authenticate)
    async verifyBiometrics() {
        if (!await this.checkSupport()) {
            throw new Error('อุปกรณ์ของคุณไม่รองรับการสแกนนิ้วมือหรือใบหน้า');
        }

        const allowCredentials = [];
        const credentialPrefix = 'biometric_credential_';

        for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index);
            if (!key || !key.startsWith(credentialPrefix)) continue;

            const savedCredential = localStorage.getItem(key);
            let credentialId;
            try {
                credentialId = JSON.parse(savedCredential);
            } catch {
                throw new Error('ข้อมูล Biometrics ในเครื่องไม่ถูกต้อง');
            }

            if (!Array.isArray(credentialId) || credentialId.length === 0 ||
                !credentialId.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
                throw new Error('ข้อมูล Biometrics ในเครื่องไม่ถูกต้อง');
            }

            allowCredentials.push({
                id: new Uint8Array(credentialId),
                type: 'public-key',
                transports: ['internal']
            });
        }

        if (allowCredentials.length === 0) {
            throw new Error('ไม่พบ Biometrics ที่บันทึกไว้ในเครื่องนี้');
        }

        const challenge = window.crypto.getRandomValues(new Uint8Array(32));

        const publicKeyCredentialRequestOptions = {
            challenge: challenge,
            allowCredentials,
            userVerification: "required",
            timeout: 60000
        };

        const assertion = await navigator.credentials.get({
            publicKey: publicKeyCredentialRequestOptions
        });

        if (!assertion) {
            throw new Error('การยืนยันตัวตนจากเครื่องไม่สำเร็จ');
        }

        return assertion;
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

async function handleBiometricVerify() {
    const statusText = document.getElementById('biometric-status');

    try {
        if (statusText) statusText.textContent = 'กำลังรอการยืนยันตัวตน...';
        await biometricAuth.verifyBiometrics();
        if (statusText) statusText.textContent = 'ยืนยันตัวตนสำเร็จ!';
        alert('สแกนผ่านเรียบร้อย! เข้าสู่ระบบสำเร็จ');
    } catch (err) {
        if (statusText) statusText.textContent = 'ยืนยันตัวตนไม่สำเร็จ';
        alert(`ยืนยันตัวตนล้มเหลว: ${err.message}`);
    }
}