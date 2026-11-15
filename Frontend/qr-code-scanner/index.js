// index.js - Entry Point ของโมดูล QR Code Scanner (Interface API)

// ประกาศตัวแปร Global ให้ระบบหลักเรียกใช้
const QRScanner = (function() {
    let core = null;

    function init() {
        if (!core) {
            // รอจนกว่าไฟล์ scanner.js โหลดเสร็จจึงสร้าง Core object
            core = new QRScannerCore();
        }
    }

    return {
        /**
         * เริ่มการสแกน QR Code ทันทีที่วิดีโอพร้อม
         * @param {HTMLVideoElement} videoElement แท็ก <video> ของระบบหลัก
         */
        start: function(videoElement) {
            init();
            core.start(videoElement);
        },

        /**
         * หยุดการสแกนด้วยตัวเอง
         */
        stop: function() {
            if (core) core.stop();
        },

        /**
         * กำหนดการกระทำเมื่อเจอข้อมูลใน QR Code
         * @param {Function} callback ฟังก์ชันที่รับตัวแปร (result) 
         */
        onResult: function(callback) {
            init();
            core.setCallback(callback);
        },

        /**
         * กำหนดการกระทำเมื่อ scanner พบข้อผิดพลาด
         */
        onError: function(callback) {
            init();
            core.setErrorCallback(callback);
        }
    };
})();
