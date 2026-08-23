// scanner.js - โลจิกดึงภาพจากวิดีโอและถอดรหัสผ่าน jsQR

class QRScannerCore {
    constructor() {
        this.videoElement = null;
        this.canvasElement = document.createElement('canvas'); // ซ่อน canvas ไว้ทำงานเบื้องหลัง
        this.canvasContext = this.canvasElement.getContext('2d', { willReadFrequently: true });
        this.isScanning = false;
        this.scanInterval = null;
        this.onResultCallback = null;
    }

    start(videoEl) {
        if (!videoEl) {
            console.error("[QRScanner] Video element not found.");
            return;
        }
        
        // ถ้ากำลังสแกนอยู่แล้ว ให้ข้าม
        if (this.isScanning) return;

        this.videoElement = videoEl;
        this.isScanning = true;
        this.hideResultUI();

        console.log("[QRScanner] Started scanning...");
        
        // รอให้ Video มีขนาดพร้อมก่อนเริ่มอ่าน
        if (this.videoElement.readyState === this.videoElement.HAVE_ENOUGH_DATA) {
            this.scanLoop();
        } else {
            this.videoElement.addEventListener('loadeddata', () => {
                this.scanLoop();
            }, { once: true });
        }
    }

    stop() {
        if (!this.isScanning) return;
        this.isScanning = false;
        if (this.scanInterval) {
            clearTimeout(this.scanInterval);
            this.scanInterval = null;
        }
        console.log("[QRScanner] Stopped scanning.");
    }

    scanLoop() {
        if (!this.isScanning) return;

        // ตรวจสอบว่าวิดีโอถูกเล่นและมีขนาด
        if (this.videoElement.readyState === this.videoElement.HAVE_ENOUGH_DATA) {
            this.canvasElement.width = this.videoElement.videoWidth;
            this.canvasElement.height = this.videoElement.videoHeight;
            
            this.canvasContext.drawImage(this.videoElement, 0, 0, this.canvasElement.width, this.canvasElement.height);
            const imageData = this.canvasContext.getImageData(0, 0, this.canvasElement.width, this.canvasElement.height);
            
            // อ่าน QR Code ด้วย jsQR
            if (typeof jsQR !== 'undefined') {
                const code = jsQR(imageData.data, imageData.width, imageData.height, {
                    inversionAttempts: "dontInvert",
                });

                if (code) {
                    console.log("[QRScanner] Found QR Code:", code.data);
                    this.stop(); // หยุดสแกนทันทีที่เจอ
                    this.showResultUI(code.data);
                    
                    if (this.onResultCallback) {
                        this.onResultCallback(code.data);
                    }
                    return; // ออกจาก loop
                }
            } else {
                console.warn("[QRScanner] jsQR library is not loaded.");
            }
        }

        // วนลูปอ่านข้อมูลต่อไปตามความถี่ที่ตั้งไว้ใน Config
        this.scanInterval = setTimeout(() => {
            requestAnimationFrame(this.scanLoop.bind(this));
        }, QRConfig.scanIntervalMs);
    }

    setCallback(callback) {
        if (typeof callback === 'function') {
            this.onResultCallback = callback;
        }
    }

    showResultUI(data) {
        const container = document.getElementById('qr-result-container');
        const dataText = document.getElementById('qr-data-value');
        if (container && dataText) {
            dataText.innerText = data || QRConfig.messages.notFound;
            container.style.display = 'flex';
        }
    }

    hideResultUI() {
        const container = document.getElementById('qr-result-container');
        if (container) {
            container.style.display = 'none';
        }
    }
}
