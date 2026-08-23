// pwa.js - Module สำหรับจัดการระบบ PWA

class PWAManager {
    constructor() {
        this.init();
    }

    init() {
        this.registerServiceWorker();
        this.handleInstallPrompt();
    }

    registerServiceWorker() {
        // ลงทะเบียน Service Worker ที่ Root directory เพื่อให้มีสิทธิ์ (Scope) ทั่วทั้งโปรเจกต์
        // ใน GitHub Pages จำเป็นต้องให้ sw.js อยู่ที่ root เพื่อไม่ให้ติดปัญหา path
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                // อ้างอิงพาธไปที่ root directory เมื่อถูกเรียกจาก index.html
                navigator.serviceWorker.register('./sw.js')
                    .then(registration => {
                        console.log('PWA Service Worker registered with scope:', registration.scope);
                    })
                    .catch(error => {
                        console.error('PWA Service Worker registration failed:', error);
                    });
            });
        } else {
            console.warn('Service Worker is not supported in this browser.');
        }
    }

    handleInstallPrompt() {
        // เพิ่มฟังก์ชันจัดการ Event 'beforeinstallprompt' ในอนาคตถ้าต้องการทำปุ่ม Install เอง
        let deferredPrompt;
        window.addEventListener('beforeinstallprompt', (e) => {
            // ป้องกันไม่ให้ Chrome แสดง mini-infobar ทันที
            e.preventDefault();
            // เก็บ event ไว้เพื่อ trigger ทีหลัง
            deferredPrompt = e;
            console.log('PWA is ready to be installed.');
            // สามารถเรียกใช้ฟังก์ชันเพื่อแสดงปุ่ม "Install App" ที่นี่
        });
    }
}

// เริ่มการทำงานของ PWA Manager ทันที
const pwaManager = new PWAManager();
