let videoStream = null;

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

    video.style.display = 'none';
    captureBtn.style.display = 'none';
    
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