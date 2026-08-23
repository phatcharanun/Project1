// config.js - เก็บการตั้งค่าทั้งหมดของ QR Scanner
const QRConfig = {
    scanIntervalMs: 300, // ความถี่ในการสแกน (ms)
    colors: {
        success: "#28a745",
        error: "#dc3545"
    },
    messages: {
        success: "สแกนสำเร็จ",
        notFound: "ไม่พบข้อมูล",
        error: "เกิดข้อผิดพลาดในการอ่าน"
    }
};
