let watchId = null;

/*
  กำหนดขอบเขต Geofence เป็น Polygon (รูปหลายเหลี่ยม)
  ใส่จุดมุมของพื้นที่เรียงต่อเนื่องรอบรูป (ตามเข็มหรือทวนเข็มก็ได้)
  ตัวอย่างนี้เป็นสี่เหลี่ยม 4 มุม — เพิ่ม/ลดจุดได้ตามรูปทรงจริงของห้อง/อาคาร
*/
const GEOFENCE_POLYGON = [
    { lat: 13.7673287, lng: 100.5141875 }, // จุดที่ 1 (จุดเริ่มต้น)
    { lat: 13.7672779, lng: 100.5143026 }, // จุดที่ 2
    { lat: 13.7672182, lng: 100.5144386 }, // จุดที่ 3
    { lat: 13.7671229, lng: 100.5143928 }, // จุดที่ 4
    { lat: 13.7672322, lng: 100.5141392 }, // จุดที่ 5
    { lat: 13.7673287, lng: 100.5141875 }  // จุดที่ 6 (จุดปิดลูป ค่าเท่ากับจุดที่ 1)
];

 

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

/*
  ตรวจสอบว่าจุด (lat, lng) อยู่ภายใน Polygon หรือไม่
  ใช้อัลกอริทึม Ray Casting: ลากเส้นแนวนอนจากจุดออกไปด้านขวา
  แล้วนับจำนวนครั้งที่เส้นนี้ตัดกับด้านของ Polygon
  ถ้าตัดเป็นจำนวนคี่ = อยู่ข้างใน, ถ้าเป็นจำนวนคู่ = อยู่ข้างนอก
  (แม่นยำเพียงพอสำหรับพื้นที่ขนาดเล็กระดับอาคาร/ห้องเรียน)
*/
function isPointInPolygon(lat, lng, polygon) {
    let inside = false;
    const n = polygon.length;

    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = polygon[i].lng, yi = polygon[i].lat;
        const xj = polygon[j].lng, yj = polygon[j].lat;

        const intersects =
            (yi > lat) !== (yj > lat) &&
            lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;

        if (intersects) inside = !inside;
    }
    return inside;
}

// คำนวณระยะทางจากจุดผู้ใช้ไปยังจุดที่ใกล้ที่สุดบน Polygon
function calculateDistanceToPolygon(lat, lng, polygon) {
    let minDistance = Number.POSITIVE_INFINITY;

    for (let i = 0; i < polygon.length; i++) {
        const p1 = polygon[i];
        const p2 = polygon[(i + 1) % polygon.length];

        const dx = p2.lng - p1.lng;
        const dy = p2.lat - p1.lat;
        const lengthSquared = dx * dx + dy * dy;

        if (lengthSquared === 0) {
            const dist = Math.hypot(lat - p1.lat, lng - p1.lng);
            minDistance = Math.min(minDistance, dist);
            continue;
        }

        const t = ((lat - p1.lat) * (p2.lat - p1.lat) + (lng - p1.lng) * (p2.lng - p1.lng)) / lengthSquared;
        const clampedT = Math.max(0, Math.min(1, t));

        const closestLat = p1.lat + clampedT * dy;
        const closestLng = p1.lng + clampedT * dx;
        const dist = Math.hypot(lat - closestLat, lng - closestLng);
        minDistance = Math.min(minDistance, dist);
    }

    return minDistance * 111000;
}

// ตรวจสอบว่าพิกัดปัจจุบันอยู่ในขอบเขต Geofence Polygon หรือไม่
function checkGeofence(userLat, userLng) {
    const statusElem = document.getElementById('geofence-status');
    const isInside = isPointInPolygon(userLat, userLng, GEOFENCE_POLYGON);

    if (isInside) {
        statusElem.innerText = 'อยู่ในเขตพื้นที่';
        statusElem.style.color = 'green';
        statusElem.style.fontWeight = 'bold';
    } else {
        const distanceMeters = calculateDistanceToPolygon(userLat, userLng, GEOFENCE_POLYGON);
        statusElem.innerText = `อยู่นอกเขตพื้นที่ ${distanceMeters.toFixed(1)} m`;
        statusElem.style.color = 'red';
        statusElem.style.fontWeight = 'normal';
    }
}