# 🛰️ Overhead — Live Satellite Tracker

A real-time, interactive 3D satellite tracker that shows which satellites (and tracked debris) are currently above your location, right in the browser — no installs, no backend.

**🌐 Live site:** https://satellite-tracker-eight.vercel.app/

## Features

- **Live location** — uses your browser's geolocation to find satellites currently overhead (falls back to a default location if permission is denied).
- **Interactive 3D globe** — drag to rotate, scroll/pinch to zoom, double-click a satellite to fly in close.
- **Real 3D satellite models** — each satellite is rendered as an actual 3D model (body, solar panels, antenna), color-coded by status:
  - 🟢 Cyan — overhead right now
  - 🟠 Amber — below your horizon
  - 🟡 Bright amber — currently selected
  - 🔴 Red — tracked space debris
- **Sky radar** — a polar (azimuth/elevation) plot showing exactly what's overhead, like a real tracking console.
- **Full technical detail on click** — NORAD ID, international designator, orbital elements (inclination, eccentricity, RAAN, argument of perigee, mean anomaly, mean motion, period, semi-major axis, perigee/apogee altitude), TLE epoch, and the raw two-line element set.
- **Time machine** — rewind or fast-forward up to 72 hours to see where satellites were/will be, with the sun's terminator line updating to match.
- **Live data** — pulls real orbital data (TLEs) from [CelesTrak](https://celestrak.org), including active satellites and known debris clouds (Cosmos-2251, Iridium-33 collision debris). Falls back to bundled sample data if the live feed is unreachable.
- **Realistic globe** — real Earth day texture, cloud layer, atmosphere glow, starfield, and sun-lit day/night shading.

## Tech stack

- Plain HTML/CSS/JavaScript — no build step, no framework
- [Three.js](https://threejs.org) (r128) for the 3D globe and satellite models
- [satellite.js](https://github.com/shashwatak/satellite-js) for SGP4 orbit propagation
- Orbital & debris data from [CelesTrak](https://celestrak.org)

## Running locally

Just open `index.html` in any modern browser. For live data to load reliably, serve it over `https://` (e.g. via Vercel) rather than opening the file directly — some browsers restrict live data fetches from local `file://` pages.

## Deploying

This is a static site — deploy with the [Vercel CLI](https://vercel.com/docs/cli):

```bash
npx vercel --prod
```

Or connect this repo to a Vercel project for automatic deployments on every commit.

## Data & accuracy notes

- Satellite positions are computed via SGP4 propagation of publicly available TLE (Two-Line Element) data. Accuracy degrades the further you rewind/fast-forward from the TLE's epoch — the app shows the data age in each satellite's detail panel.
- Purpose descriptions are heuristic (based on satellite name patterns), not an official database.
