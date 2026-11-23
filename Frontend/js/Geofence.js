let gpsRequestPending = false;
let activeSessionId = null;
let lastPosition = null;
let geofenceCheckSequence = 0;

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function setGeofenceStatus(message, color, bold) {
    const statusElem = document.getElementById('geofence-status');
    statusElem.textContent = message;
    statusElem.style.color = color;
    statusElem.style.fontWeight = bold ? 'bold' : 'normal';
}

function setGeofenceSessionFromQr(qrData) {
    let sessionId = qrData.trim();
    try {
        const payload = JSON.parse(sessionId);
        if (payload && typeof payload === 'object') {
            sessionId = payload.session_id;
        }
    } catch (error) {
        // A raw UUID is also a supported QR payload.
    }

    if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
        console.warn('[Geofence] QR session rejected: expected a UUID or JSON with session_id.');
        setGeofenceStatus('QR ไม่มี session_id ที่ถูกต้อง', 'red', false);
        return false;
    }

    activeSessionId = sessionId;
    console.log('[Geofence] QR session accepted.');
    if (lastPosition) {
        checkGeofence(lastPosition.latitude, lastPosition.longitude);
    } else {
        setGeofenceStatus('รับ QR แล้ว กรุณาเปิด GPS', '#555', false);
    }
    return true;
}

function toggleGPS() {
    const btn = document.getElementById('btn-get-location');

    if (gpsRequestPending) {
        return;
    }
    if (!window.isSecureContext) {
        setGeofenceStatus('GPS ต้องใช้งานผ่าน HTTPS หรือ localhost', 'red', false);
        return;
    }
    if (!('geolocation' in navigator)) {
        setGeofenceStatus('อุปกรณ์ไม่รองรับ Geolocation API', 'red', false);
        return;
    }

    gpsRequestPending = true;
    btn.disabled = true;
    setGeofenceStatus('กำลังระบุตำแหน่ง GPS...', '#555', false);
    navigator.geolocation.getCurrentPosition(
        position => {
            gpsRequestPending = false;
            btn.disabled = false;
            handleSuccess(position);
        },
        error => {
            gpsRequestPending = false;
            btn.disabled = false;
            handleError(error);
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        }
    );
}

function handleSuccess(position) {
    const currentLat = position.coords.latitude;
    const currentLng = position.coords.longitude;
    lastPosition = { latitude: currentLat, longitude: currentLng };

    const map = document.getElementById('location-map');
    const mapCell = `${currentLat.toFixed(4)},${currentLng.toFixed(4)}`;
    if (map && map.dataset.mapCell !== mapCell) {
        const west = (currentLng - 0.0004).toFixed(6);
        const south = (currentLat - 0.00025).toFixed(6);
        const east = (currentLng + 0.0004).toFixed(6);
        const north = (currentLat + 0.00025).toFixed(6);
        map.src = `https://www.openstreetmap.org/export/embed.html?bbox=${west}%2C${south}%2C${east}%2C${north}&layer=mapnik&marker=${currentLat}%2C${currentLng}`;
        map.dataset.mapCell = mapCell;
    }

    checkGeofence(currentLat, currentLng);
}

function handleError(error) {
    console.error('GPS Error:', error);
    const message = error.code === error.PERMISSION_DENIED
        ? 'ผู้ใช้ปฏิเสธการเข้าถึงตำแหน่ง'
        : 'เกิดข้อผิดพลาดในการดึงตำแหน่ง';
    setGeofenceStatus(message, 'red', false);
}

async function checkGeofence(latitude, longitude) {
    const requestSequence = ++geofenceCheckSequence;
    const checkMode = activeSessionId ? 'QR session' : 'default geofence';
    console.log(`[Geofence] Check started (${checkMode}).`);
    setGeofenceStatus('กำลังตรวจสอบพื้นที่กับ PostGIS...', '#555', false);

    try {
        const requestBody = { latitude, longitude };
        if (activeSessionId) {
            requestBody.session_id = activeSessionId;
        }
        const response = await fetch('/api/geofence/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });
        const result = await response.json();

        if (requestSequence !== geofenceCheckSequence) {
            return;
        }
        if (response.status === 404) {
            console.warn(`[Geofence] Check failed (${checkMode}): session not found.`);
            setGeofenceStatus('ไม่พบรอบเช็คชื่อนี้', 'red', false);
            return;
        }
        if (response.status === 410) {
            console.warn(`[Geofence] Check failed (${checkMode}): session is not active.`);
            setGeofenceStatus('รอบเช็คชื่อนี้ยังไม่เริ่มหรือหมดเวลาแล้ว', 'red', false);
            return;
        }
        if (response.status === 503 && result.error === 'DEFAULT_GEOFENCE_NOT_CONFIGURED') {
            console.warn('[Geofence] Check failed (default geofence): not configured.');
            setGeofenceStatus('ยังไม่ได้ตั้งค่า Geofence ใน PostGIS', 'red', false);
            return;
        }
        if (!response.ok || typeof result.inside !== 'boolean') {
            throw new Error(`Geofence API returned HTTP ${response.status}`);
        }

        console.log('[Geofence] Check result:', {
            mode: checkMode,
            status: result.status,
            source: result.source,
            inside: result.inside,
            distance_meters: result.distance_meters
        });
        const distanceText = !result.inside && Number.isFinite(result.distance_meters)
            ? ` ${result.distance_meters.toFixed(1)} m`
            : '';
        setGeofenceStatus(
            result.inside
                ? 'อยู่ในเขตพื้นที่ (PostGIS)'
                : `อยู่นอกเขตพื้นที่${distanceText} (PostGIS)`,
            result.inside ? 'green' : 'red',
            result.inside
        );
    } catch (error) {
        if (requestSequence !== geofenceCheckSequence) {
            return;
        }
        console.error(`[Geofence] API request failed (${checkMode}):`, error);
        setGeofenceStatus('ตรวจสอบพื้นที่ไม่ได้ กรุณาลองใหม่', 'red', false);
    }
}
