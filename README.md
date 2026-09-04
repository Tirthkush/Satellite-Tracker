# 🛰️ SatTracker 3D — Live Satellite Tracker

A real-time interactive 3D satellite tracking application that visualizes publicly available orbital data and continuously calculates satellite positions using SGP4/SDP4 propagation.

🌐 **Live site:** https://satellite-tracker-eight.vercel.app/

> **Important:** Satellite positions shown by this application are calculated predictions from orbital elements. They are not live telemetry or direct observations.

---

## 🚀 Features

### 🌍 Interactive 3D Globe

- Interactive 3D Earth visualization using Three.js
- Rotate, zoom and explore the globe
- Satellite objects displayed around Earth
- Click visible satellites to inspect their propagated orbital information
- Earth day/night visualization and starfield

### 🛰️ Multiple Satellite Catalogs

The tracker supports multiple CelesTrak catalogs:

- **Stations** — Space stations and related tracked objects
- **Starlink** — Starlink satellite constellation
- **Brightest** — Visually prominent satellite objects
- **Active** — Active satellite catalog
- **FY-1C Debris** — Fengyun-1C debris catalog

Catalogs are loaded through the application's backend rather than directly from the browser.

### 📡 Live Orbital Data Pipeline

The application uses the following architecture:

```text
CelesTrak GP API
       ↓
Vercel Serverless API
       ↓
Catalog validation & cache
       ↓
Browser
       ↓
satellite.js
       ↓
SGP4 / SDP4 propagation
       ↓
3D satellite visualization
