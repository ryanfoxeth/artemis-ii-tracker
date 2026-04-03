# Artemis II Tracker

Live tracking of NASA's Artemis II mission -- the first crewed flight to the Moon in over 50 years.

Real-time spacecraft telemetry powered by JPL Horizons ephemeris data.

![Artemis II Tracker](screenshot.png)

## What it shows

- **Live position** of the Orion spacecraft relative to Earth and Moon
- **Trajectory path** from launch to current position
- **Distance and speed** in real-time (km and miles)
- **Mission timeline** with completed and upcoming events
- **Crew roster** -- Reid Wiseman, Victor Glover, Christina Koch, Jeremy Hansen

## Quick start

```bash
git clone https://github.com/ryanfoxeth/artemis-ii-tracker.git
cd artemis-ii-tracker
npm install
npm start
```

Open http://localhost:3000

## How it works

Fetches real-time state vectors from [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) for the Orion spacecraft (object ID -1024). Positions are computed relative to both Earth and Moon reference frames.

Data is cached locally (2 min for current position, 10 min for trajectory) to respect JPL's rate limits.

## Mission window

Artemis II launched April 1, 2026 at 6:35 PM EDT from Kennedy Space Center. The mission lasts approximately 10 days with a lunar flyby and return to Earth.

## Data source

All orbital data comes directly from NASA/JPL's Horizons system. No API key required. No third-party services.

## License

MIT
