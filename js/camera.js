let videoStream = null;
let qrScanTimer = null;
let qrDetector = null;

// ฟังก์ชันเปิดใช้งานกล้อง
async function startCamera() {
    const video = document.getElementById('webcam');
    const startBtn = document.getElementById('btn-start-camera');
    const captureBtn = document.getElementById('btn-capture');

    try {
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
        video.style.display = 'block';

        // เริ่มอ่านคิวอาร์โค้ดจากภาพวิดีโอแบบต่อเนื่อง
        if ('BarcodeDetector' in window) {
            try {
                qrDetector = new BarcodeDetector({ formats: ['qr_code'] });
                scanQRCode(video);
            } catch (err) {
                console.error('ไม่สามารถเริ่มตัวอ่าน QR ได้: ', err);
            }
        } else {
            console.warn('เบราว์เซอร์นี้ไม่รองรับการอ่าน QR Code');
        }
        
        // สลับสถานะปุ่มกด
        startBtn.innerText = 'ปิดกล้อง';
        startBtn.onclick = stopCamera;
        captureBtn.style.display = 'inline-block';

    } catch (err) {
        console.error("ไม่สามารถเข้าถึงกล้องได้: ", err);
        alert("ไม่สามารถเปิดกล้องได้ กรุณาตรวจสอบการอนุญาตสิทธิ์ (Permission)");
    }
}

// ฟังก์ชันปิดกล้อง
function stopCamera() {
    const video = document.getElementById('webcam');
    const startBtn = document.getElementById('btn-start-camera');
    const captureBtn = document.getElementById('btn-capture');

    if (videoStream) {
        // ปิด Track วิดีโอทั้งหมด
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
    }

    if (qrScanTimer) {
        clearTimeout(qrScanTimer);
        qrScanTimer = null;
    }
    qrDetector = null;

    video.style.display = 'none';
    captureBtn.style.display = 'none';
    
    startBtn.innerText = 'เปิดกล้อง';
    startBtn.onclick = startCamera;
}

// อ่าน QR Code จากวิดีโอ โดยไม่ต้องส่งภาพไปยังเซิร์ฟเวอร์
async function scanQRCode(video) {
    if (!qrDetector || !videoStream) return;

    if (video.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
        try {
            const codes = await qrDetector.detect(video);
            if (codes.length > 0 && codes[0].rawValue) {
                const value = codes[0].rawValue;
                const preview = document.getElementById('photo-preview');
                preview.innerHTML = `
                    <h3 style="margin-top: 15px;">QR Code:</h3>
                    <p style="word-break: break-all;">${escapeHtml(value)}</p>
                `;
            }
        } catch (err) {
            console.error('อ่าน QR Code ไม่สำเร็จ: ', err);
        }
    }

    if (videoStream) qrScanTimer = setTimeout(() => scanQRCode(video), 200);
}

function escapeHtml(value) {
    return value.replace(/[&<>'"]/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[character]));
}

// ฟังก์ชันถ่ายภาพนิ่ง
function takeSnapshot() {
    const video = document.getElementById('webcam');
    const canvas = document.getElementById('canvas');
    const preview = document.getElementById('photo-preview');

    if (!videoStream) return;

    // ตั้งขนาด Canvas เท่ากับวิดีโอจริง
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // วาดภาพจาก Video ลงบน Canvas
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    // แปลงภาพเป็น Data URL และนำไปแสดงในแท็ก <img>
    const imageDataUrl = canvas.toDataURL('image/png');
    preview.innerHTML = `
        <h3 style="margin-top: 15px;">รูปที่ถ่าย:</h3>
        <img src="${imageDataUrl}" alt="Captured Photo" style="width: 100%; max-width: 400px; border-radius: 8px; border: 2px solid #ccc;" />
    `;
}
