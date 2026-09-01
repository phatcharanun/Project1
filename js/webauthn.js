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

// Global Instance & UI Helper
const biometricAuth = new BiometricAuth();

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