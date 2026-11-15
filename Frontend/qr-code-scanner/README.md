# QR Code Scanner Module

ระบบแสกน QR Code แบบแยก Module ออกจากระบบหลัก 100% 

## หลักการทำงาน
- ไม่เขียน Camera API ซ้ำซ้อน แต่รับ Video Stream (จากระบบกล้องหลัก) มาแปลงเป็น Canvas แบบเบื้องหลังเพื่อค้นหา QR Code
- ใช้ไลบรารี `jsQR` (ดึงผ่าน CDN) เพื่อถอดรหัส QR จากพิกเซลของภาพ
- แสดงผล ✓ ทันทีเมื่ออ่านเจอ และแสดงข้อมูลผลลัพธ์ผ่านหน้าจอ

## API สำหรับระบบหลัก

```javascript
// เรียกใช้งานเมื่อต้องการรับผล
QRScanner.onResult((data) => {
    console.log("ได้ข้อมูล:", data);
});

QRScanner.onError((message) => {
    console.error("Scanner error:", message);
});

// ส่ง <video> ให้เริ่มแสกนทันที
QRScanner.start(document.getElementById('webcam'));

// บังคับหยุดแสกน
QRScanner.stop();
```

เมื่ออ่านสำเร็จ โมดูลจะหยุด scanner และเรียก callback เพียงครั้งเดียว ระบบหลักจึงหยุด Camera Stream ได้ใน callback โดยไม่สร้าง stream ใหม่ในโมดูล หากข้อมูลเป็น URL ที่ใช้ `http` หรือ `https` โมดูลจะพยายามเปิดแท็บใหม่อัตโนมัติและแสดงลิงก์สำรอง หากเป็นข้อความจะแสดงข้อมูลพร้อมปุ่มคัดลอก

## ไฟล์ในโฟลเดอร์นี้
- `index.js`: ตัวจัดการและ Expose `QRScanner` สู่ Global Scope
- `scanner.js`: ทำหน้าที่จัดการ Canvas, วนลูปอ่านข้อมูล, ถอดรหัส, แสดง UI 
- `scanner.css`: อนิเมชัน
- `config.js`: เก็บตั้งค่าทั่วไป
