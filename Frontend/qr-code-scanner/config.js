// config.js - เก็บการตั้งค่าทั้งหมดของ QR Scanner
const QRConfig = {
    scanIntervalMs: 300, // ความถี่ในการสแกน (ms)
    urlOpenDelayMs: 150,
    colors: {
        success: "#28a745",
        error: "#dc3545"
    },
    messages: {
        success: "สแกนสำเร็จ",
        notFound: "ไม่พบข้อมูล",
        error: "เกิดข้อผิดพลาดในการอ่าน",
        cameraUnavailable: "ไม่พบกล้องหรือกล้องยังไม่พร้อม",
        permissionDenied: "ไม่ได้รับอนุญาตให้ใช้กล้อง",
        libraryUnavailable: "ระบบอ่าน QR Code ยังไม่พร้อม",
        dataLabel: "ข้อมูลที่อ่านได้:",
        urlDetected: "กำลังเปิดลิงก์:",
        openUrl: "เปิดลิงก์",
        copy: "คัดลอกข้อความ",
        copied: "คัดลอกแล้ว",
        copyFailed: "คัดลอกไม่สำเร็จ"
    }
};
