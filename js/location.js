// // 1. กำหนดพิกัดของกรอบพื้นที่ (ตัวอย่างพิกัดสี่เหลี่ยมรอบพื้นที่เป้าหมาย)
// // *ต้องลากพิกัดจุดมุมเรียงต่อกันจนครบรอบ*
// const registrationZone = [
//     { lat: 13.767038, lng: 100.514539 },
//     { lat: 13.767106, lng: 100.514562 },
//     { lat: 13.767096, lng: 100.514537 },
//     { lat: 13.767090, lng: 100.514515 }
// ];

// // 2. เมื่อกดปุ่มลงทะเบียนในหน้าเว็บ ให้ดึงพิกัด GPS มาตรวจสอบ
// function handleRegistration() {
//     navigator.geolocation.getCurrentPosition((position) => {
//         const userLocation = {
//             lat: position.coords.latitude,
//             lng: position.coords.longitude
//         };

//         // เรียกใช้ฟังก์ชันตรวจสอบที่สร้างไว้ข้างต้น
//         const canRegister = isPointInPolygon(userLocation, registrationZone);

//         if (canRegister) {
//             alert("คุณอยู่ในพื้นที่ที่กำหนด อนุญาตให้ลงทะเบียนได้!");
//             // ทำกระบวนการลงทะเบียนหรือเปิดกล้องสแกน QR Code ต่อไป
//         } else {
//             alert("ปฏิเสธ: คุณอยู่นอกขอบเขตพื้นที่ลงทะเบียน");
//         }
//     }, (error) => {
//         alert("ไม่สามารถดึงตำแหน่งพิกัดของคุณได้ กรุณาเปิด GPS");
//     }, {
//         enableHighAccuracy: true // บังคับใช้ความแม่นยำสูง
//     });
// }







// let watchId = null;
const GEOFENCE_TARGET = [
    { lat: 13.767038, lng: 100.514539 }, // จุดมุมซ้ายล่าง
    { lat: 13.767106, lng: 100.514539 }, // จุดมุมขวาล่าง
    { lat: 13.767106, lng: 100.514562 }, // จุดมุมขวาบน
    { lat: 13.767038, lng: 100.514562 }  // จุดมุมซ้ายบน
];

function isPointInPolygon(point, polygon) {
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].lng;
        const yi = polygon[i].lat;
        const xj = polygon[j].lng;
        const yj = polygon[j].lat;

        const intersect = ((yi > point.lat) !== (yj > point.lat)) &&
            (point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi);

        if (intersect) inside = !inside;
    }

    return inside;
}
// // กำหนดจุดศูนย์กลาง Geofence (ตัวอย่าง: เสาเสาชิงช้า กรุงเทพฯ)
// const GEOFENCE_TARGET = {
//     lat: 13.7516,
//     lng: 100.5014,
//     radiusMeters: 100 // รัศมีขอบเขต 100 เมตร
// };

// ฟังก์ชันเปิด/ปิดการติดตาม GPS
function toggleGPS() {
    const btn = document.getElementById('btn-get-location');

    if (watchId === null) {
        if ('geolocation' in navigator) {
            // เริ่มติดตามพิกัดตำแหน่ง
            watchId = navigator.geolocation.watchPosition(
                handleSuccess, 
                handleError, 
                {
                    enableHighAccuracy: true, // ขอความแม่นยำสูง
                    timeout: 10000,
                    maximumAge: 0
                }
            );
            btn.innerText = 'ปิดการติดตาม GPS';
            btn.style.backgroundColor = '#dc3545';
        } else {
            alert('อุปกรณ์ของคุณไม่รองรับ Geolocation API');
        }
    } else {
        // ยกเลิกการติดตาม
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
        
        document.getElementById('lat-val').innerText = '-';
        document.getElementById('lng-val').innerText = '-';
        document.getElementById('geofence-status').innerText = 'ปิดใช้งาน';
        document.getElementById('geofence-status').style.color = '#000';

        btn.innerText = 'เปิดใช้งาน GPS ติดตามตำแหน่ง';
        btn.style.backgroundColor = '#007bff';
    }
}

// Callback เมื่ออ่านค่าตำแหน่งสำเร็จ
function handleSuccess(position) {
    const currentLat = position.coords.latitude;
    const currentLng = position.coords.longitude;

    // อัปเดต UI พิกัด
    document.getElementById('lat-val').innerText = currentLat.toFixed(6);
    document.getElementById('lng-val').innerText = currentLng.toFixed(6);

    // ตรวจสอบสถานะ Geofence
    checkGeofence(currentLat, currentLng);
}

// Callback เมื่อเกิดข้อผิดพลาด
function handleError(error) {
    console.error("GPS Error: ", error);
    let message = "เกิดข้อผิดพลาดในการดึงตำแหน่ง";
    if (error.code === error.PERMISSION_DENIED) {
        message = "ผู้ใช้ปฏิเสธการเข้าถึงสิทธิ์ตำแหน่ง (Location Permission)";
    }
    alert(message);
}

// คำนวณระยะทางระหว่าง 2 พิกัดด้วยสูตร Haversine (หน่วย: เมตร)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // รัศมีของโลก (เมตร)
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
              
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // ระยะทางจริงในหน่วยเมตร
}

// ตรวจสอบว่าพิกัดปัจจุบันอยู่ในรัศมี Geofence หรือไม่
function checkGeofence(userLat, userLng) {
    const distance = calculateDistance(
        userLat, 
        userLng, 
        GEOFENCE_TARGET.lat, 
        GEOFENCE_TARGET.lng
    );

    const statusElem = document.getElementById('geofence-status');

    if (distance <= GEOFENCE_TARGET.radiusMeters) {
        statusElem.innerText = `อยู่ในเขตพื้นที่! (ห่างจุดเป้าหมาย ${distance.toFixed(1)} เมตร)`;
        statusElem.style.color = 'green';
        statusElem.style.fontWeight = 'bold';
    } else {
        statusElem.innerText = `อยู่นอกเขตพื้นที่ (ห่างจุดเป้าหมาย ${distance.toFixed(1)} เมตร)`;
        statusElem.style.color = 'red';
        statusElem.style.fontWeight = 'normal';
    }
}