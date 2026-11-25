// js/attendance.js - Offline-first attendance: every scan is saved in IndexedDB first, then sent to the server.

const ATTENDANCE_RETRY_MS = 60_000;
const ATTENDANCE_TIMEOUT_MS = 15_000;
const LOGOUT_PENDING_KEY = 'cams_logout_pending';

const ATTENDANCE_LABELS = {
    PENDING: 'รอส่ง',
    PASSED: 'เช็คชื่อสำเร็จ',
    FLAGGED: 'ส่งแล้ว รอตรวจสอบ',
    REJECTED: 'ไม่ผ่าน'
};

// Final answers from the server. Any other failure keeps the scan in the queue.
const ATTENDANCE_REJECTIONS = {
    SESSION_NOT_FOUND: 'ไม่พบรอบเช็คชื่อนี้',
    SESSION_NOT_ACTIVE: 'อยู่นอกเวลาเช็คชื่อหรือเกินเวลาส่งข้อมูล',
    OUTSIDE_GEOFENCE: 'อยู่นอกเขตพื้นที่',
    INVALID_SESSION_ID: 'ข้อมูล QR ไม่ถูกต้อง',
    INVALID_LATITUDE: 'ตำแหน่งไม่ถูกต้อง',
    INVALID_LONGITUDE: 'ตำแหน่งไม่ถูกต้อง',
    INVALID_ELAPSED_MS: 'เกินเวลาส่งข้อมูล'
};

let attendanceDb = null;
let attendanceSync = Promise.resolve();
let attendanceProblem = null; // null | 'LOGIN' | 'SERVER'

function openAttendanceDb() {
    attendanceDb ??= new Promise((resolve, reject) => {
        const request = indexedDB.open('cams-attendance', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('scans', { keyPath: 'id' });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
            attendanceDb = null;
            reject(request.error);
        };
    });
    return attendanceDb;
}

// Resolves on transaction complete, so a saved scan is really stored.
async function withScans(mode, run) {
    const db = await openAttendanceDb();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('scans', mode);
        const request = run(transaction.objectStore('scans'));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = () => reject(transaction.error);
    });
}

async function getStudentScans() {
    const studentId = biometricAuth.getStudentId();
    const scans = await withScans('readonly', store => store.getAll());
    return scans.filter(scan => scan.studentId === studentId).sort((a, b) => a.scannedAt - b.scannedAt);
}

async function getPendingScans() {
    return (await getStudentScans()).filter(scan => scan.status === 'PENDING');
}

function describeScan(scan) {
    return scan.status === 'FAILED'
        ? `ไม่สำเร็จ: ${ATTENDANCE_REJECTIONS[scan.error]}`
        : ATTENDANCE_LABELS[scan.status];
}

function setAttendanceStatus(message) {
    document.getElementById('attendance-status').textContent = message;
}

async function recordAttendance(sessionId, latitude, longitude) {
    const scan = {
        id: crypto.randomUUID(),
        studentId: biometricAuth.getStudentId(),
        sessionId,
        latitude,
        longitude,
        scannedAt: Date.now(),
        status: 'PENDING',
        courseId: null,
        error: null
    };
    await withScans('readwrite', store => store.put(scan));
    navigator.storage?.persist?.().catch(() => {}); // Ask the browser not to evict unsent scans.
    setAttendanceStatus('บันทึกในเครื่องแล้ว กำลังส่ง...');
    await syncAttendance();

    const saved = await withScans('readonly', store => store.get(scan.id));
    const message = saved.status === 'PENDING'
        ? 'บันทึกในเครื่องแล้ว จะส่งเมื่อเชื่อมต่อได้'
        : describeScan(saved);
    setAttendanceStatus(message);
    setGeofenceStatus(message, saved.status === 'PASSED' ? 'green' : saved.status === 'FAILED' ? 'red' : '#555', false);
}

// Runs are chained, so a scan added during a run is picked up by the next one and never sent twice at once.
function syncAttendance() {
    attendanceSync = attendanceSync
        .then(sendPendingScans)
        .then(renderAttendance)
        .catch(error => console.error('[Attendance] Sync failed:', error));
    return attendanceSync;
}

async function sendPendingScans() {
    attendanceProblem = null;
    if (!navigator.onLine) return;
    if (!biometricAuth.getStudentId()) {
        await finishLogout();
        return;
    }

    for (const scan of await getPendingScans()) {
        let response;
        let result;
        try {
            response = await fetch('/api/attendance', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    student_id: scan.studentId,
                    session_id: scan.sessionId,
                    latitude: scan.latitude,
                    longitude: scan.longitude,
                    elapsed_ms: Math.max(0, Date.now() - scan.scannedAt)
                }),
                signal: AbortSignal.timeout(ATTENDANCE_TIMEOUT_MS)
            });
            result = await response.json();
        } catch (error) {
            attendanceProblem = 'SERVER';
            return;
        }

        if (response.ok && ATTENDANCE_LABELS[result.status]) {
            scan.status = result.status;
            scan.courseId = result.course_id;
        } else if (ATTENDANCE_REJECTIONS[result.error]) {
            scan.status = 'FAILED';
            scan.error = result.error;
        } else {
            attendanceProblem = ['LOGIN_REQUIRED', 'STUDENT_MISMATCH'].includes(result.error) ? 'LOGIN' : 'SERVER';
            return;
        }
        await withScans('readwrite', store => store.put(scan));
    }
}

// The login cookie is HttpOnly, so a logout made offline can only clear it once the server is reachable.
async function finishLogout() {
    if (!localStorage.getItem(LOGOUT_PENDING_KEY)) return;
    try {
        await postAuth('/logout', {});
        localStorage.removeItem(LOGOUT_PENDING_KEY);
    } catch (error) {
        console.warn('[Attendance] Logout will be retried:', error.message);
    }
}

async function renderAttendance() {
    const scans = await getStudentScans();
    const pending = scans.filter(scan => scan.status === 'PENDING').length;

    document.body.classList.toggle('offline', !navigator.onLine);
    let message = '';
    if (!navigator.onLine) {
        message = pending ? `ออฟไลน์ · รอส่ง ${pending} รายการ` : 'ออฟไลน์ · ยังสแกนเช็คชื่อได้ ระบบจะส่งให้เมื่อมีเน็ต';
    } else if (pending && attendanceProblem === 'LOGIN') {
        message = `รอส่ง ${pending} รายการ · กด "ยืนยันตัวตน" ที่หน้าหลักเพื่อส่ง`;
    } else if (pending && attendanceProblem === 'SERVER') {
        message = `เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ · รอส่ง ${pending} รายการ ระบบจะลองใหม่อัตโนมัติ`;
    }
    const banner = document.getElementById('network-status');
    banner.textContent = message;
    banner.hidden = !message;

    document.getElementById('attendance-empty').hidden = scans.length > 0;
    document.getElementById('attendance-history').replaceChildren(...scans.reverse().map(scan => {
        const row = document.createElement('li');
        const course = document.createElement('span');
        const detail = document.createElement('span');
        course.textContent = scan.courseId || `รอบ ${scan.sessionId.slice(0, 8)}`;
        detail.textContent = `${new Date(scan.scannedAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })} · ${describeScan(scan)}`;
        row.append(course, detail);
        return row;
    }));
}

window.addEventListener('online', () => {
    const map = document.getElementById('location-map');
    map.src = map.src; // Reload the map that failed to load while offline.
    syncAttendance();
});
window.addEventListener('offline', syncAttendance);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncAttendance();
});
setInterval(() => {
    if (attendanceProblem === 'SERVER') syncAttendance();
}, ATTENDANCE_RETRY_MS);
syncAttendance();
