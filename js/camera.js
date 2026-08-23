let videoStream = null;

// ฟังก์ชันเปิดใช้งานกล้อง
async function startCamera() {
    const video = document.getElementById('webcam');
    const startBtn = document.getElementById('btn-start-camera');
    const captureBtn = document.getElementById('btn-capture');

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
        video.style.display = 'block';
        
        // สลับสถานะปุ่มกด
        startBtn.innerText = 'ปิดกล้อง';
        startBtn.onclick = stopCamera;
        captureBtn.style.display = 'inline-block';

        if (typeof QRScanner !== 'undefined') {
            QRScanner.onResult((result) => {
                console.log("แอพหลักได้รับข้อมูล QR Code:", result);
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
    const captureBtn = document.getElementById('btn-capture');

    if (videoStream) {
        // ปิด Track วิดีโอทั้งหมด
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
    }

    video.style.display = 'none';
    captureBtn.style.display = 'none';
    
    // [QRScanner Module] หยุดการสแกน
    if (typeof QRScanner !== 'undefined') {
        QRScanner.stop();
    }
    
    startBtn.innerText = 'เปิดกล้อง';
    startBtn.onclick = startCamera;
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