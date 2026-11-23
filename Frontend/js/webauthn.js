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

    // ตรวจสอบว่ามีข้อมูลลงทะเบียนไว้ในเครื่องนี้แล้วหรือไม่
    hasRegisteredCredential() {
        const credentialPrefix = 'biometric_credential_';
        for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index);
            if (key && key.startsWith(credentialPrefix)) {
                return true;
            }
        }
        return false;
    }

    // ลงทะเบียน Biometrics (สร้าง Credential ใหม่บนอุปกรณ์นี้)
    async registerBiometrics(username = 'student') {
        if (!await this.checkSupport()) {
            throw new Error('อุปกรณ์ของคุณไม่รองรับการสแกนนิ้วมือหรือใบหน้า (Platform Authenticator)');
        }

        const userId = window.crypto.getRandomValues(new Uint8Array(16));
        const challenge = window.crypto.getRandomValues(new Uint8Array(32));

        const publicKeyCredentialCreationOptions = {
            challenge,
            rp: {
                name: "CAMS Attendance",
                id: window.location.hostname
            },
            user: {
                id: userId,
                name: username,
                displayName: `Student: ${username}`
            },
            pubKeyCredParams: [
                { alg: -7, type: "public-key" },  // ES256
                { alg: -257, type: "public-key" } // RS256 (Windows Hello)
            ],
            authenticatorSelection: {
                authenticatorAttachment: "platform", // สแกนนิ้วมือ/Face บนเครื่อง
                userVerification: "required"
            },
            timeout: 60000
        };

        const credential = await navigator.credentials.create({
            publicKey: publicKeyCredentialCreationOptions
        });

        if (!credential) {
            throw new Error('การลงทะเบียนสแกนนิ้วมือไม่สำเร็จ');
        }

        const credentialId = Array.from(new Uint8Array(credential.rawId));
        localStorage.setItem(`biometric_credential_${username}`, JSON.stringify(credentialId));

        return credential;
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
                continue;
            }

            if (Array.isArray(credentialId) && credentialId.length > 0 &&
                credentialId.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
                allowCredentials.push({
                    id: new Uint8Array(credentialId),
                    type: 'public-key',
                    transports: ['internal']
                });
            }
        }

        // หากยังไม่เคยลงทะเบียนในโดเมนนี้มาก่อน ให้สลับไปลงทะเบียนผูกอุปกรณ์ครั้งแรกทันที
        if (allowCredentials.length === 0) {
            return await this.registerBiometrics();
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
        const isRegistered = biometricAuth.hasRegisteredCredential();
        if (statusText) {
            statusText.textContent = isRegistered
                ? 'กำลังรอการยืนยันลายนิ้วมือ/ใบหน้า...'
                : 'กำลังลงทะเบียนลายนิ้วมือเพื่อผูกอุปกรณ์ครั้งแรก...';
        }

        await biometricAuth.verifyBiometrics();

        if (statusText) {
            statusText.textContent = isRegistered
                ? 'ยืนยันตัวตนสำเร็จ!'
                : 'ลงทะเบียนลายนิ้วมือสำเร็จ!';
        }
        alert(isRegistered
            ? 'สแกนลายนิ้วมือผ่านเรียบร้อย! เข้าสู่ระบบสำเร็จ'
            : 'ลงทะเบียนลายนิ้วมือกับอุปกรณ์นี้เรียบร้อยแล้ว! ครั้งต่อไปสามารถแตะสแกนเพื่อยืนยันตัวตนได้ทันที');
    } catch (err) {
        if (statusText) statusText.textContent = 'ยืนยันตัวตนไม่สำเร็จ';
        if (err.name === 'NotAllowedError') {
            alert('การสแกนถูกยกเลิก หรือหมดเวลา');
        } else {
            alert(`ยืนยันตัวตนล้มเหลว: ${err.message}`);
        }
    }
}

async function handleBiometricRegister() {
    const statusText = document.getElementById('biometric-status');

    try {
        if (statusText) statusText.textContent = 'กำลังลงทะเบียนลายนิ้วมือใหม่...';
        await biometricAuth.registerBiometrics();
        if (statusText) statusText.textContent = 'ลงทะเบียนลายนิ้วมือสำเร็จ!';
        alert('ลงทะเบียนลายนิ้วมือกับอุปกรณ์นี้เรียบร้อยแล้ว');
    } catch (err) {
        if (statusText) statusText.textContent = 'ลงทะเบียนไม่สำเร็จ';
        if (err.name === 'NotAllowedError') {
            alert('การลงทะเบียนถูกยกเลิก หรือหมดเวลา');
        } else {
            alert(`ลงทะเบียนล้มเหลว: ${err.message}`);
        }
    }
}
