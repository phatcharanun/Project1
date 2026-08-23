// scanner.js - โลจิกดึงภาพจากวิดีโอและถอดรหัสผ่าน jsQR

class QRScannerCore {
    constructor() {
        this.videoElement = null;
        this.canvasElement = document.createElement('canvas'); // ซ่อน canvas ไว้ทำงานเบื้องหลัง
        this.canvasContext = this.canvasElement.getContext('2d', { willReadFrequently: true });
        this.isScanning = false;
        this.scanInterval = null;
        this.onResultCallback = null;
        this.onErrorCallback = null;
        this.hasResult = false;
    }

    start(videoEl) {
        if (!videoEl) {
            this.reportError(QRConfig.messages.cameraUnavailable);
            return;
        }
        
        // ถ้ากำลังสแกนอยู่แล้ว ให้ข้าม
        if (this.isScanning) return;

        this.videoElement = videoEl;
        this.isScanning = true;
        this.hasResult = false;
        this.hideResultUI();

        console.log("[QRScanner] Started scanning...");
        
        // รอให้ Video มีขนาดพร้อมก่อนเริ่มอ่าน
        if (this.videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
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
        if (this.videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            this.canvasElement.width = this.videoElement.videoWidth;
            this.canvasElement.height = this.videoElement.videoHeight;
            
            this.canvasContext.drawImage(this.videoElement, 0, 0, this.canvasElement.width, this.canvasElement.height);
            const imageData = this.canvasContext.getImageData(0, 0, this.canvasElement.width, this.canvasElement.height);
            
            // อ่าน QR Code ด้วย jsQR
            if (typeof jsQR === 'function') {
                const code = jsQR(imageData.data, imageData.width, imageData.height, {
                    inversionAttempts: "dontInvert",
                });

                if (code?.data && !this.hasResult) {
                    console.log("[QRScanner] Found QR Code:", code.data);
                    this.hasResult = true;
                    this.stop(); // หยุดสแกนทันทีที่เจอ
                    this.showResultUI(code.data);
                    
                    if (this.onResultCallback) {
                        this.onResultCallback(code.data);
                    }
                    return; // ออกจาก loop
                }
            } else {
                this.stop();
                this.reportError(QRConfig.messages.libraryUnavailable);
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

    setErrorCallback(callback) {
        if (typeof callback === 'function') {
            this.onErrorCallback = callback;
        }
    }

    reportError(message) {
        console.error('[QRScanner]', message);
        const container = document.getElementById('qr-result-container');
        const dataText = document.getElementById('qr-data-value');
        const successText = container?.querySelector('.qr-success-text');
        if (container && dataText && successText) {
            successText.textContent = QRConfig.messages.error;
            successText.classList.add('qr-error-text');
            dataText.textContent = message;
            container.style.display = 'flex';
        }
        if (this.onErrorCallback) this.onErrorCallback(message);
    }

    showResultUI(data) {
        const container = document.getElementById('qr-result-container');
        const dataText = document.getElementById('qr-data-value');
        if (container && dataText) {
            const successText = container.querySelector('.qr-success-text');
            successText.textContent = QRConfig.messages.success;
            successText.classList.remove('qr-error-text');
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
