# Geofence API

The API serves the frontend at `http://localhost:3000` and uses PostGIS as the
only source of truth for geofence checks. Open the frontend from this address,
not from a separate static server.

## Run

From the repository root:

```powershell
docker compose up -d --build geofence-api
```

The database must have the schema and `point_in_geofence(geometry, geometry)`
function from `init.sql`. Docker runs that initialization script only when the
PostgreSQL data volume is first created. The init script also seeds a default
geofence using the polygon previously configured in the frontend. On an existing
database, apply the `geofence_config` table and seed insert from `init.sql`.

## QR payload

The attendance QR must contain either the session UUID directly:

```text
00000000-0000-4000-8000-000000000001
```

or a JSON object with a `session_id` property:

```json
{"session_id":"00000000-0000-4000-8000-000000000001"}
```

When a QR is scanned, its referenced `attendance_session` must exist and its
`valid_time_range` must include the current time. Before scanning, the API uses
the default polygon stored in `geofence_config`.

## API

`POST /api/geofence/check`

```json
{
  "session_id": "00000000-0000-4000-8000-000000000001",
  "latitude": 13.76724,
  "longitude": 100.51428
}
```

The API returns `inside: true|false`, an `INSIDE`/`OUTSIDE` status, and the
distance to the boundary when outside. The coordinates are converted to an SRID
4326 point and checked by `point_in_geofence`. An unknown or inactive scanned
session returns HTTP 404 or 410. Invalid coordinates return HTTP 400.

Check database connectivity and function availability:

```powershell
Invoke-RestMethod http://localhost:3000/api/health
```

## Tests

```powershell
node --test Backend/Node.test.js
```

For an end-to-end check, scan an active session QR, enable GPS, and confirm the
UI displays a status ending in `(PostGIS)`. The UI needs browser location
permission and HTTPS or localhost.
