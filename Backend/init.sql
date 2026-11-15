-- เปิดใช้งาน Extension PostGIS และ UUID
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. ตารางข้อมูลระบบลูกข่าย (Client Systems)
CREATE TABLE clients (
    client_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_name VARCHAR(255) NOT NULL,
    api_key_hash VARCHAR(255) NOT NULL,
    webhook_url VARCHAR(512),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. ตารางข้อมูลผู้ใช้และอุปกรณ์ (User & Device Binding / WebAuthn)
CREATE TABLE user_device (
    device_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(client_id) ON DELETE CASCADE,
    external_user_id VARCHAR(100) NOT NULL,
    credential_id TEXT UNIQUE NOT NULL,
    public_key TEXT NOT NULL,
    device_fingerprint VARCHAR(255),
    last_ip VARCHAR(45),
    is_trusted BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. ตารางรอบการเช็คชื่อและขอบเขตพื้นที่ (Attendance Session & Geofence Polygon)
CREATE TABLE attendance_session (
    session_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(client_id) ON DELETE CASCADE,
    course_id VARCHAR(100) NOT NULL,
    geofence_polygon GEOMETRY(Polygon, 4326) NOT NULL,
    valid_time_range TSTZRANGE NOT NULL,
    qr_secret_seed VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ray-casting point-in-polygon test. Polygon holes are handled by toggling
-- inside/outside for every ring; points on any polygon boundary count as inside.
CREATE OR REPLACE FUNCTION point_in_geofence(
    p_point GEOMETRY,
    p_polygon GEOMETRY
) RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
    ring_index INTEGER;
    ring_count INTEGER;
    vertex_index INTEGER;
    vertex_count INTEGER;
    ring GEOMETRY;
    p1 GEOMETRY;
    p2 GEOMETRY;
    point_x DOUBLE PRECISION;
    point_y DOUBLE PRECISION;
    p1_x DOUBLE PRECISION;
    p1_y DOUBLE PRECISION;
    p2_x DOUBLE PRECISION;
    p2_y DOUBLE PRECISION;
    intersection_x DOUBLE PRECISION;
    inside BOOLEAN := FALSE;
BEGIN
    IF p_point IS NULL OR p_polygon IS NULL THEN
        RETURN FALSE;
    END IF;
    IF GeometryType(p_point) <> 'POINT' THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'p_point must be a Point geometry';
    END IF;
    IF GeometryType(p_polygon) <> 'POLYGON' THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'p_polygon must be a Polygon geometry';
    END IF;
    IF ST_SRID(p_point) <> 4326 OR ST_SRID(p_polygon) <> 4326 THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'p_point and p_polygon must use SRID 4326';
    END IF;
    IF ST_IsEmpty(p_point) OR ST_IsEmpty(p_polygon) THEN
        RETURN FALSE;
    END IF;
    IF NOT ST_IsValid(p_polygon) THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'p_polygon must be a valid Polygon';
    END IF;

    -- Treat shell and hole boundaries as part of the geofence.
    IF ST_Intersects(p_point, ST_Boundary(p_polygon)) THEN
        RETURN TRUE;
    END IF;

    point_x := ST_X(p_point);
    point_y := ST_Y(p_point);
    ring_count := ST_NumInteriorRings(p_polygon);

    FOR ring_index IN 0..ring_count LOOP
        IF ring_index = 0 THEN
            ring := ST_ExteriorRing(p_polygon);
        ELSE
            ring := ST_InteriorRingN(p_polygon, ring_index);
        END IF;

        vertex_count := ST_NPoints(ring);
        FOR vertex_index IN 1..(vertex_count - 1) LOOP
            p1 := ST_PointN(ring, vertex_index);
            p2 := ST_PointN(ring, vertex_index + 1);
            p1_x := ST_X(p1);
            p1_y := ST_Y(p1);
            p2_x := ST_X(p2);
            p2_y := ST_Y(p2);

            IF (p1_y > point_y) <> (p2_y > point_y) THEN
                intersection_x := p1_x
                    + (point_y - p1_y) * (p2_x - p1_x) / (p2_y - p1_y);
                IF point_x < intersection_x THEN
                    inside := NOT inside;
                END IF;
            END IF;
        END LOOP;
    END LOOP;

    RETURN inside;
END;
$$;

COMMENT ON FUNCTION point_in_geofence(GEOMETRY, GEOMETRY) IS
    'Returns true when an SRID 4326 point is in or on a valid Polygon geofence, using ray casting.';

-- สร้าง Spatial Index (GiST) เพื่อเพิ่มความเร็วในการคำนวณ Ray-Casting
CREATE INDEX idx_session_geofence ON attendance_session USING GIST (geofence_polygon);

-- 4. ตารางบันทึกประวัติการเช็คชื่อและคะแนนความเสี่ยง (Attendance Log)
CREATE TABLE attendance_log (
    log_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES attendance_session(session_id) ON DELETE CASCADE,
    external_user_id VARCHAR(100) NOT NULL,
    provider_used VARCHAR(50) NOT NULL,
    risk_score DECIMAL(3,2) NOT NULL,
    location_point GEOMETRY(Point, 4326),
    status VARCHAR(20) NOT NULL CHECK (status IN ('PASSED', 'FLAGGED', 'REJECTED')),
    override_by VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    -- ป้องกันการเช็คชื่อซ้ำในคาบเรียนเดียวกัน
    UNIQUE (session_id, external_user_id)
);

-- สร้าง Spatial Index สำหรับจุดเช็คชื่อ
CREATE INDEX idx_log_location ON attendance_log USING GIST (location_point);