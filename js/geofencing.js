// ฟังก์ชันเช็กว่าพิกัด (Point) อยู่ในกรอบ (Polygon) หรือไม่ (Ray-Casting Algorithm)
function isPointInPolygon(point, polygon) {
    const x = point.lat, y = point.lng;
    let inside = false;
    
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].lat, yi = polygon[i].lng;
        const xj = polygon[j].lat, yj = polygon[j].lng;
        
        const intersect = ((yi > y) !== (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    
    return inside;
}

// ส่งออกฟังก์ชันไปใช้งาน (หากต้องการผูกเข้ากับระบบตรวจสอบ)
export { isPointInPolygon };


