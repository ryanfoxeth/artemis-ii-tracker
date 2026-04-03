import { Router } from 'express';
import fetch from 'node-fetch';

const router = Router();

// JPL Horizons API base
const HORIZONS_API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const ORION_ID = '-1024'; // Artemis II / Integrity Orion EM-2

// Cache to avoid hammering JPL (they ask for one request at a time)
let cache = { earth: null, moon: null, trajectory: null };
let cacheTime = { earth: 0, moon: 0, trajectory: 0 };
const CACHE_TTL = 120_000; // 2 minutes

// Mission timeline events (UTC) — sourced from JPL Horizons spacecraft object data
const MISSION_EVENTS = [
  { time: '2026-04-01T22:35:00Z', event: 'Launch', description: 'SLS liftoff from LC-39B, Kennedy Space Center' },
  { time: '2026-04-02T23:49:00Z', event: 'TLI', description: 'Trans-Lunar Injection burn (5m 55s, 388 m/s delta-v)' },
  { time: '2026-04-06T04:43:00Z', event: 'Lunar SOI Entry', description: 'Orion enters lunar sphere of influence' },
  { time: '2026-04-06T23:06:00Z', event: 'Lunar Flyby', description: 'Closest approach to the Moon' },
  { time: '2026-04-07T17:27:00Z', event: 'Lunar SOI Exit', description: 'Orion exits lunar sphere of influence' },
  { time: '2026-04-11T00:04:00Z', event: 'Entry Interface', description: 'Entry interface — 122 km above Earth' },
  { time: '2026-04-11T00:17:00Z', event: 'Splashdown', description: 'Pacific Ocean splashdown off Baja California' },
];

/**
 * Parse Horizons vector table text into structured data.
 * The result field contains the full text output; we extract
 * rows between $$SOE and $$EOE markers.
 */
function parseVectors(resultText) {
  const soeIdx = resultText.indexOf('$$SOE');
  const eoeIdx = resultText.indexOf('$$EOE');
  if (soeIdx === -1 || eoeIdx === -1) return [];

  const block = resultText.substring(soeIdx + 5, eoeIdx).trim();
  const lines = block.split('\n').map(l => l.trim()).filter(Boolean);

  const entries = [];
  // Horizons vector table format: each entry is 3 lines
  // Line 1: JDTDB = ..., CalendarDate(TDB) = ...
  // Line 2: X = ... Y = ... Z = ...
  // Line 3: VX= ... VY= ... VZ= ...
  for (let i = 0; i < lines.length; i += 3) {
    if (i + 2 >= lines.length) break;
    const timeLine = lines[i];
    const posLine = lines[i + 1];
    const velLine = lines[i + 2];

    // Extract calendar date
    const calMatch = timeLine.match(/A\.D\.\s+(\d{4}-[A-Za-z]{3}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+)/);
    const jdMatch = timeLine.match(/(\d+\.\d+)\s*=/);

    // Extract position values
    const xMatch = posLine.match(/X\s*=\s*([-\d.E+]+)/i);
    const yMatch = posLine.match(/Y\s*=\s*([-\d.E+]+)/i);
    const zMatch = posLine.match(/Z\s*=\s*([-\d.E+]+)/i);

    // Extract velocity values
    const vxMatch = velLine.match(/VX\s*=\s*([-\d.E+]+)/i);
    const vyMatch = velLine.match(/VY\s*=\s*([-\d.E+]+)/i);
    const vzMatch = velLine.match(/VZ\s*=\s*([-\d.E+]+)/i);

    if (xMatch && yMatch && zMatch && vxMatch && vyMatch && vzMatch) {
      const x = parseFloat(xMatch[1]);
      const y = parseFloat(yMatch[1]);
      const z = parseFloat(zMatch[1]);
      const vx = parseFloat(vxMatch[1]);
      const vy = parseFloat(vyMatch[1]);
      const vz = parseFloat(vzMatch[1]);
      const distance = Math.sqrt(x * x + y * y + z * z);
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);

      entries.push({
        calendar: calMatch ? calMatch[1].trim() : null,
        jd: jdMatch ? parseFloat(jdMatch[1]) : null,
        position: { x, y, z },
        velocity: { vx, vy, vz },
        distance_km: distance,
        speed_kmps: speed,
        speed_kmph: speed * 3600,
      });
    }
  }
  return entries;
}

/**
 * Fetch vectors from Horizons for a given center body.
 * center: '500@399' (Earth) or '500@301' (Moon)
 */
async function fetchVectors(center, startTime, stopTime, stepSize = '10m') {
  const params = new URLSearchParams({
    format: 'json',
    COMMAND: `'${ORION_ID}'`,
    EPHEM_TYPE: 'VECTORS',
    CENTER: `'${center}'`,
    START_TIME: `'${startTime}'`,
    STOP_TIME: `'${stopTime}'`,
    STEP_SIZE: `'${stepSize}'`,
    OUT_UNITS: 'KM-S',
    VEC_TABLE: '2',
    OBJ_DATA: 'NO',
    MAKE_EPHEM: 'YES',
  });

  const resp = await fetch(`${HORIZONS_API}?${params}`);
  if (!resp.ok) throw new Error(`Horizons API returned ${resp.status}`);
  const json = await resp.json();
  if (!json.result) throw new Error('No result from Horizons');
  return parseVectors(json.result);
}

/**
 * GET /api/artemisii/now
 * Current position relative to Earth and Moon, plus computed metrics.
 * No auth required — public tracker.
 */
router.get('/now', async (_req, res) => {
  try {
    const now = new Date();
    // Query a small window around "now" — Horizons needs start < stop
    const start = new Date(now.getTime() - 5 * 60_000); // 5 min ago
    const stop = new Date(now.getTime() + 5 * 60_000);  // 5 min ahead
    const fmt = (d) => d.toISOString().replace('T', ' ').replace('Z', '');

    const useCache = (key) => cache[key] && (Date.now() - cacheTime[key] < CACHE_TTL);

    let earthData, moonData;

    if (useCache('earth') && useCache('moon')) {
      earthData = cache.earth;
      moonData = cache.moon;
    } else {
      // Fetch sequentially to respect JPL's one-request-at-a-time policy
      earthData = await fetchVectors('500@399', fmt(start), fmt(stop), '5m');
      cache.earth = earthData;
      cacheTime.earth = Date.now();

      moonData = await fetchVectors('500@301', fmt(start), fmt(stop), '5m');
      cache.moon = moonData;
      cacheTime.moon = Date.now();
    }

    // Pick the entry closest to "now"
    const pickClosest = (entries) => {
      if (!entries || entries.length === 0) return null;
      // Just return the middle entry (closest to now)
      return entries[Math.floor(entries.length / 2)];
    };

    const earth = pickClosest(earthData);
    const moon = pickClosest(moonData);

    if (!earth || !moon) {
      return res.status(503).json({ error: 'No ephemeris data available — spacecraft may be outside trajectory window' });
    }

    // Determine mission phase
    const missionStart = new Date('2026-04-01T22:35:00Z');
    const elapsed = now - missionStart;
    const elapsedHours = elapsed / 3_600_000;
    const elapsedDays = elapsed / 86_400_000;

    // Find current and next event
    let currentEvent = null;
    let nextEvent = null;
    for (let i = 0; i < MISSION_EVENTS.length; i++) {
      const eventTime = new Date(MISSION_EVENTS[i].time);
      if (now >= eventTime) {
        currentEvent = MISSION_EVENTS[i];
      } else if (!nextEvent) {
        nextEvent = MISSION_EVENTS[i];
      }
    }

    res.json({
      timestamp: now.toISOString(),
      mission_elapsed: {
        hours: Math.round(elapsedHours * 10) / 10,
        days: Math.round(elapsedDays * 100) / 100,
        formatted: `${Math.floor(elapsedDays)}d ${Math.floor(elapsedHours % 24)}h ${Math.floor((elapsed / 60_000) % 60)}m`,
      },
      earth: {
        position_km: earth.position,
        velocity_kmps: earth.velocity,
        distance_km: Math.round(earth.distance_km),
        distance_miles: Math.round(earth.distance_km * 0.621371),
        speed_kmps: Math.round(earth.speed_kmps * 1000) / 1000,
        speed_kmph: Math.round(earth.speed_kmph),
        speed_mph: Math.round(earth.speed_kmph * 0.621371),
      },
      moon: {
        position_km: moon.position,
        velocity_kmps: moon.velocity,
        distance_km: Math.round(moon.distance_km),
        distance_miles: Math.round(moon.distance_km * 0.621371),
        speed_kmps: Math.round(moon.speed_kmps * 1000) / 1000,
        speed_kmph: Math.round(moon.speed_kmph),
        speed_mph: Math.round(moon.speed_kmph * 0.621371),
      },
      mission_phase: currentEvent?.event || 'Pre-Launch',
      next_event: nextEvent ? {
        event: nextEvent.event,
        description: nextEvent.description,
        time: nextEvent.time,
      } : null,
      source: 'JPL Horizons (NASA/JPL)',
      spacecraft: 'Artemis II — Orion "Integrity" (EM-2)',
      crew: ['Reid Wiseman', 'Victor Glover', 'Christina Koch', 'Jeremy Hansen'],
    });
  } catch (err) {
    console.error('Artemis II /now error:', err.message);
    res.status(502).json({ error: 'Failed to fetch Horizons data', detail: err.message });
  }
});

/**
 * GET /api/artemisii/trajectory
 * Full mission trajectory (Earth-relative) at 1-hour intervals.
 * Returns the path from launch to current time (or end of available data).
 */
router.get('/trajectory', async (_req, res) => {
  try {
    if (cache.trajectory && (Date.now() - cacheTime.trajectory < 600_000)) {
      return res.json(cache.trajectory);
    }

    const missionStart = '2026-04-01 22:35';
    const now = new Date();
    const stop = new Date(Math.min(now.getTime(), new Date('2026-04-13T00:00:00Z').getTime()));
    const fmt = (d) => d.toISOString().replace('T', ' ').replace('Z', '');

    const entries = await fetchVectors('500@399', missionStart, fmt(stop), '1h');

    const result = {
      count: entries.length,
      reference: 'Earth center (ecliptic J2000)',
      units: { position: 'km', velocity: 'km/s' },
      points: entries.map(e => ({
        time: e.calendar,
        x: e.position.x,
        y: e.position.y,
        z: e.position.z,
        distance_km: Math.round(e.distance_km),
        speed_kmps: Math.round(e.speed_kmps * 1000) / 1000,
      })),
      events: MISSION_EVENTS,
    };

    cache.trajectory = result;
    cacheTime.trajectory = Date.now();
    res.json(result);
  } catch (err) {
    console.error('Artemis II /trajectory error:', err.message);
    res.status(502).json({ error: 'Failed to fetch trajectory', detail: err.message });
  }
});

/**
 * GET /api/artemisii/events
 * Mission timeline events.
 */
router.get('/events', (_req, res) => {
  const now = new Date();
  res.json(MISSION_EVENTS.map(e => ({
    ...e,
    status: now >= new Date(e.time) ? 'completed' : 'upcoming',
  })));
});

export default router;
