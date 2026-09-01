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

    // ลงทะเบียน Biometrics (Register)
    async registerBiometrics(studentId) {
        if (!await this.checkSupport()) {
            throw new Error('อุปกรณ์ของคุณไม่รองรับการสแกนนิ้วมือหรือใบหน้า');
        }

        const userId = new TextEncoder().encode(studentId);
        const challenge = window.crypto.getRandomValues(new Uint8Array(32));

        const publicKeyCredentialCreationOptions = {
            challenge: challenge,
            rp: {
                name: "PWA Camera & GPS App",
                id: window.location.hostname
            },
            user: {
                id: userId,
                name: studentId,
                displayName: `Student: ${studentId}`
            },
            pubKeyCredParams: [{ alg: -7, type: "public-key" }], // ES256
            authenticatorSelection: {
                authenticatorAttachment: "platform", // บังคับใช้ biometric บนเครื่องมือถือ
                userVerification: "required"
            },
            timeout: 60000
        };

        const credential = await navigator.credentials.create({
            publicKey: publicKeyCredentialCreationOptions
        });

        // บันทึก Credential ID ไว้ในเครื่องชั่วคราว (หรือส่งไปบันทึกบน Server)
        const credentialId = Array.from(new Uint8Array(credential.rawId));
        localStorage.setItem(`biometric_credential_${studentId}`, JSON.stringify(credentialId));

        return credential;
    }

    // ยืนยันตัวตนด้วย Biometrics (Authenticate)
    async verifyBiometrics(studentId) {
        if (!await this.checkSupport()) {
            throw new Error('อุปกรณ์ของคุณไม่รองรับการสแกนนิ้วมือหรือใบหน้า');
        }

        const savedCredential = localStorage.getItem(`biometric_credential_${studentId}`);
        if (!savedCredential) {
            throw new Error('ไม่พบข้อมูล Biometrics ในเครื่องนี้ กรุณาลงทะเบียนก่อน');
        }

        const rawId = new Uint8Array(JSON.parse(savedCredential));
        const challenge = window.crypto.getRandomValues(new Uint8Array(32));

        const publicKeyCredentialRequestOptions = {
            challenge: challenge,
            allowCredentials: [{
                id: rawId,
                type: 'public-key',
                transports: ['internal']
            }],
            userVerification: "required",
            timeout: 60000
        };

        const assertion = await navigator.credentials.get({
            publicKey: publicKeyCredentialRequestOptions
        });

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
        if (statusText) statusText.textContent = 'กำลังเปิดกล้องหน้าของโทรศัพท์...';
        await faceScanner.openCamera();
        if (resultBox) resultBox.innerHTML = 'กล้องหน้าเปิดแล้ว พร้อมสำหรับสแกนใบหน้า';
        if (statusText) statusText.textContent = 'กล้องหน้าใช้งานได้';
    } catch (err) {
        if (statusText) statusText.textContent = 'ไม่สามารถเปิดกล้องหน้าได้';
        if (resultBox) resultBox.innerHTML = `ข้อผิดพลาด: ${err.message}`;
        alert(err.message);
    }
}

async function handleFaceScan() {
    const studentIdInput = document.getElementById('student-id-input')?.value;
    const statusText = document.getElementById('biometric-status');

    if (!studentIdInput) {
        alert('กรุณากรอกรหัสนักศึกษาเพื่อสแกนใบหน้า');
        return;
    }

    try {
        if (statusText) statusText.textContent = 'กำลังสแกนใบหน้า...';
        const result = await faceScanner.scanFace(studentIdInput);
        if (statusText) {
            statusText.textContent = result.success ? 'สแกนใบหน้าเรียบร้อยแล้ว' : 'สแกนหน้าไม่สำเร็จ';
        }
    } catch (err) {
        if (statusText) statusText.textContent = 'ไม่สามารถสแกนใบหน้าได้';
        const resultBox = document.getElementById('face-result');
        if (resultBox) resultBox.innerHTML = `ข้อผิดพลาด: ${err.message}`;
        alert(err.message);
    }
}

async function handleBiometricRegister() {
    const studentIdInput = document.getElementById('student-id-input')?.value;
    const statusText = document.getElementById('biometric-status');

    if (!studentIdInput) {
        alert('กรุณากรอกรหัสนักศึกษาก่อนลงทะเบียน Biometrics');
        return;
    }

    try {
        if (statusText) statusText.textContent = 'กำลังรอการสแกนนิ้วมือ/ใบหน้า...';
        await biometricAuth.registerBiometrics(studentIdInput);
        if (statusText) statusText.textContent = 'ลงทะเบียน Biometrics สำเร็จ!';
        alert('ผูกอุปกรณ์ด้วย Fingerprint / FaceID เรียบร้อยแล้ว');
    } catch (err) {
        if (statusText) statusText.textContent = 'การลงทะเบียนล้มเหลว';
        alert(`เกิดข้อผิดพลาด: ${err.message}`);
    }
}

async function handleBiometricVerify() {
    const studentIdInput = document.getElementById('student-id-input')?.value;
    const statusText = document.getElementById('biometric-status');

    if (!studentIdInput) {
        alert('กรุณากรอกรหัสนักศึกษา');
        return;
    }

    try {
        if (statusText) statusText.textContent = 'กำลังรอการยืนยันตัวตน...';
        await biometricAuth.verifyBiometrics(studentIdInput);
        if (statusText) statusText.textContent = 'ยืนยันตัวตนสำเร็จ!';
        alert('สแกนผ่านเรียบร้อย! เข้าสู่ระบบสำเร็จ');
    } catch (err) {
        if (statusText) statusText.textContent = 'ยืนยันตัวตนไม่สำเร็จ';
        alert(`ยืนยันตัวตนล้มเหลว: ${err.message}`);
    }
}