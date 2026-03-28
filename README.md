# 🏠 10523 HQ — Home Intelligence Dashboard
Elmsford · Westchester County, NY

---

## Option A — Instant Start (no install needed)

Just double-click `public/index.html` to open it in your browser.

These panels work immediately with no server:
- ✅ Weather + 7-day forecast (NWS)
- ✅ Active weather alerts (NWS / Westchester)
- ✅ USGS earthquake feed
- ✅ Live aircraft overhead (OpenSky ADS-B)
- ✅ Reddit r/Westchester
- ✅ Local news (lohud, Patch, Rivertowns — via proxy)
- ✅ Events (sample data)
- ✅ Maps (Leaflet / CartoDB Dark)
- 🔗 Services / Crimes / Calendars show quick links to check manually

---

## Option B — Full Server (live service status, crime data, calendar scraping)

Requires Node.js from https://nodejs.org (LTS version, free)

```cmd
cd C:\path\to\dashboard
node server.js
```

Then open: http://localhost:3000

No `npm install` needed — uses only Node.js built-in modules.

This adds:
- ✅ ConEd, Comcast, Verizon, NatGrid, SUEZ live status
- ✅ SpotCrime incident feed + crime map
- ✅ Elmsford.gov + Tarrytown village calendar scraping
- ✅ RSS news without CORS restrictions

---

## Samsung Frame Display (future)

Once the server is running, navigate to:
`http://[your-computer-IP]:3000`

from the Frame TV browser. Find your IP with:
```cmd
ipconfig
```
Look for "IPv4 Address" under your WiFi adapter.

---

## File Structure
```
dashboard/
├── server.js          ← Node.js backend (zero dependencies)
├── package.json
├── README.md
└── public/
    ├── index.html     ← Open this directly, or serve via server
    ├── css/style.css
    └── js/app.js
```
