let videoStream = null;

async function openQRScannerPage() {
    document.body.classList.remove('notifications-page');
    document.body.classList.add('qr-scanner-page');
    document.querySelector('.app-header h1').textContent = 'สแกนคิวอาร์โค้ด';
    document.getElementById('btn-start-camera').onclick = startCamera;
    await startCamera();
}

function openNotificationsPage() {
    if (document.body.classList.contains('qr-scanner-page')) {
        closeQRScannerPage();
    }
    document.body.classList.add('notifications-page');
    document.querySelector('.app-header h1').textContent = 'การแจ้งเตือน';
}

function closeNotificationsPage() {
    document.body.classList.remove('notifications-page');
    document.querySelector('.app-header h1').textContent = 'For Students';
}

function closeAppPage() {
    closeQRScannerPage();
    closeNotificationsPage();
}

function closeQRScannerPage() {
    stopCamera();
    document.body.classList.remove('qr-scanner-page');
    document.querySelector('.app-header h1').textContent = 'For Students';
    const startBtn = document.getElementById('btn-start-camera');
    document.getElementById('qr-camera-button-label').textContent = 'สแกนคิวอาร์โค้ด';
    startBtn.onclick = openQRScannerPage;
    document.getElementById('qr-result-container').style.display = 'none';
}

// ฟังก์ชันเปิดใช้งานกล้อง
async function startCamera() {
    const video = document.getElementById('webcam');
    const startBtn = document.getElementById('btn-start-camera');
    const buttonLabel = document.getElementById('qr-camera-button-label');

    try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
            throw new Error('SECURE_CONTEXT_REQUIRED');
        }

        if (videoStream) return;

        // ขอเข้าถึงกล้องหลัง (environment)
        videoStream = await navigator.mediaDevices.getUserMedia({
            video: { 
                facingMode: { ideal: "environment" },
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: false
        });

        // เล่นวิดีโอในแท็ก <video>
        video.srcObject = videoStream;
        
        // สลับสถานะปุ่มกด
        buttonLabel.textContent = 'ปิดกล้อง';
        startBtn.onclick = stopCamera;

        if (typeof QRScanner !== 'undefined') {
            QRScanner.onResult((result) => {
                console.log("แอพหลักได้รับข้อมูล QR Code:", result);
                stopCamera();
            });
            QRScanner.start(video);
        }


    } catch (err) {
        console.error("ไม่สามารถเข้าถึงกล้องได้: ", err);
        const message = err.message === 'SECURE_CONTEXT_REQUIRED'
            ? 'ต้องเปิดเว็บไซต์ผ่าน HTTPS หรือ localhost จึงจะใช้กล้องได้'
            : 'ไม่สามารถเปิดกล้องได้ กรุณาตรวจสอบการอนุญาตสิทธิ์ (Permission)';
        alert(message);
    }
}

// ฟังก์ชันปิดกล้อง
function stopCamera() {
    const video = document.getElementById('webcam');
    const startBtn = document.getElementById('btn-start-camera');
    const buttonLabel = document.getElementById('qr-camera-button-label');

    if (videoStream) {
        // ปิด Track วิดีโอทั้งหมด
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
    }

    video.srcObject = null;
    
    // [QRScanner Module] หยุดการสแกน
    if (typeof QRScanner !== 'undefined') {
        QRScanner.stop();
    }
    
    buttonLabel.textContent = 'เปิดกล้อง';
    startBtn.onclick = startCamera;
}
