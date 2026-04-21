/* ═══════════════════════════════════════════════════════════════
   10523 HQ — Dashboard Application
   Elmsford, Westchester County, NY
   ═══════════════════════════════════════════════════════════════ */

// ─── CONFIGURATION ──────────────────────────────────────────────
const CFG = {
  lat: 41.0534, lon: -73.8196,
  zip: '10523', city: 'Elmsford', state: 'NY',
  nwsZone: 'NYZ069',       // Westchester County
  nwsCounty: 'NYC049',     // Westchester county code
  openSkyBounds: { lamin: 40.55, lomin: -74.40, lamax: 41.55, lomax: -72.90 },
  subreddits: ['Westchester', 'thetriangle'],
  rssSources: [
    { name: 'Westchester',  url: 'https://news.google.com/rss/search?q=Westchester+County+New+York+news&hl=en-US&gl=US&ceid=US:en' },
    { name: 'Local',        url: 'https://news.google.com/rss/search?q=Elmsford+OR+Tarrytown+OR+%22Sleepy+Hollow%22+OR+%22White+Plains%22+New+York&hl=en-US&gl=US&ceid=US:en' },
    { name: 'Rivertowns',   url: 'https://rivertownsenterprise.net/feed/' },
  ],
  refresh: {
    weather:   10 * 60 * 1000,
    alerts:     5 * 60 * 1000,
    aircraft:  600 * 1000,   // 10 min — OpenSky free tier ~100 req/day
    community: 15 * 60 * 1000,
    services:  10 * 60 * 1000,
  },
  cartoTiles: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  cartoAttr: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors © <a href="https://carto.com/">CARTO</a>'
};

// ─── STATE ──────────────────────────────────────────────────────
let maps = {};
let nwsGrid = null;
let aircraftMarkers = [];
let crimeMarkers = [];
let allAircraft = [];
let allEvents = [];
let allNews = [];
let calendarData = { elmsford: [], tarrytown: [] };
let activeEventFilter = 'all';
let servicesData = [];
// AIS state is declared near the AIS section below

// ─── UTILITIES ──────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const fmt = (n, dec = 0) => n != null ? Number(n).toFixed(dec) : '—';
const kph2mph = k => (k * 0.621371).toFixed(0);
const ms2mph  = m => (m * 2.23694).toFixed(0);
const m2ft    = m => (m * 3.28084).toFixed(0);
const degToCard = d => { if (d == null) return '—'; const dirs = ['N','NE','E','SE','S','SW','W','NW']; return dirs[Math.round(d/45)%8]; };
const timeAgo = d => {
  const s = Math.floor((Date.now() - new Date(d)) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
};
const fmtDate = d => {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
};
const fmtTime = d => {
  if (!d) return '';
  return new Date(d).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
};
const wxIcon = (shortForecast) => {
  const s = (shortForecast || '').toLowerCase();
  if (s.includes('thunder')) return '⛈️';
  if (s.includes('snow') || s.includes('flurr')) return '❄️';
  if (s.includes('sleet') || s.includes('mix')) return '🌨️';
  if (s.includes('fog') || s.includes('haz')) return '🌫️';
  if (s.includes('shower') || s.includes('rain') || s.includes('drizzle')) return '🌧️';
  if (s.includes('partly') || s.includes('mostly cloud')) return '⛅';
  if (s.includes('cloud') || s.includes('overcast')) return '☁️';
  if (s.includes('wind')) return '💨';
  if (s.includes('sunny') || s.includes('clear')) return '☀️';
  return '🌡️';
};
const crimeColor = type => {
  const t = (type || '').toLowerCase();
  if (t.includes('assault') || t.includes('robbery') || t.includes('shoot')) return '#ef4444';
  if (t.includes('theft') || t.includes('burglary') || t.includes('larceny')) return '#f59e0b';
  if (t.includes('vandal') || t.includes('graffiti')) return '#a78bfa';
  if (t.includes('drug') || t.includes('dui') || t.includes('alcohol')) return '#f472b6';
  return '#64748b';
};
const statusColor = s => ({ operational:'ok', degraded:'warn', outage:'bad', unknown:'unk' }[s] || 'unk');
const statusText  = s => ({ operational:'Operational', degraded:'Service Issues', outage:'Outage Reported', unknown:'Status Unknown' }[s] || 'Unknown');

// ─── DATETIME ───────────────────────────────────────────────────
function updateDateTime() {
  const now = new Date();
  const date = now.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' });
  const time = now.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', second:'2-digit' });
  $('datetime').innerHTML = `<span>${date}</span> &nbsp; ${time}`;
}
setInterval(updateDateTime, 1000);
updateDateTime();

// ─── TAB NAVIGATION ─────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${name}`));
  // Lazy-init marine map the first time that tab is opened
  if (name === 'marine') setTimeout(initMarineMap, 50);
  // Invalidate all Leaflet maps so they redraw at correct size
  setTimeout(() => { Object.values(maps).forEach(m => { try { m.invalidateSize(); } catch(e){} }); }, 120);
}
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeEventFilter = btn.dataset.filter;
      renderEventsGrid();
    });
  });
}

// ─── LEAFLET MAPS ───────────────────────────────────────────────
function initMaps() {
  const tileOpts = { attribution: CFG.cartoAttr, subdomains: 'abcd', maxZoom: 19 };

  // Mini traffic map (All tab) → Waze iframe (no Leaflet init needed)
  // Transport map → Waze iframe (no Leaflet init needed)

  // Crime map → SpotCrime.io iframe (no Leaflet init needed)

  // Aviation map
  maps.aviation = L.map('aviation-map', { zoomControl:true })
    .setView([CFG.lat, CFG.lon], 9);
  L.tileLayer(CFG.cartoTiles, tileOpts).addTo(maps.aviation);
  L.circleMarker([CFG.lat, CFG.lon], { color:'#38bdf8', fillColor:'#38bdf8', fillOpacity:1, radius:8, weight:2 })
    .addTo(maps.aviation).bindPopup('🏠 Home — 10523');

  // 25-mile radius circle on aviation map
  L.circle([CFG.lat, CFG.lon], { radius: 40234, color:'#a78bfa', fillColor:'#a78bfa', fillOpacity:0.04, dashArray:'6 4', weight:1 })
    .addTo(maps.aviation).bindPopup('25mi monitoring radius');

  // NOTE: Marine map initializes lazily when the Marine tab is first opened
  // (Leaflet errors on hidden/zero-size elements, which would crash init() and block all feeds)
}

function initMarineMap() {
  if (maps.marine) return; // already initialized
  const tileOpts = { attribution: CFG.cartoAttr, subdomains: 'abcd', maxZoom: 19 };
  maps.marine = L.map('marine-map', { zoomControl: true })
    .setView([41.05, -73.97], 10);
  L.tileLayer(CFG.cartoTiles, tileOpts).addTo(maps.marine);
  L.polyline([[40.57,-74.02],[40.70,-74.00],[40.90,-73.97],[41.10,-73.95],[41.25,-73.96],[41.40,-73.97],[41.55,-73.96]], {
    color:'#06b6d4', weight:2, opacity:0.25, dashArray:'4 4'
  }).addTo(maps.marine).bindPopup('Hudson River');
  L.circleMarker([CFG.lat, CFG.lon], { color:'#38bdf8', fillColor:'#38bdf8', fillOpacity:1, radius:6, weight:2 })
    .addTo(maps.marine).bindPopup('🏠 Home — 10523 (5mi from Hudson)');
  // Re-draw any vessel markers that arrived before the map was ready
  Object.keys(vesselMap).forEach(mmsi => updateVesselMarker(mmsi));
  maps.marine.invalidateSize();
}

// ─── WEATHER (NWS) ──────────────────────────────────────────────
async function getNWSGrid() {
  if (nwsGrid) return nwsGrid;
  const r = await fetch(`https://api.weather.gov/points/${CFG.lat},${CFG.lon}`);
  const d = await r.json();
  nwsGrid = d.properties;
  return nwsGrid;
}

async function fetchWeather() {
  try {
    const grid = await getNWSGrid();
    const [fcstRes, hourlyRes] = await Promise.all([
      fetch(grid.forecast),
      fetch(grid.forecastHourly)
    ]);
    const fcst   = await fcstRes.json();
    const hourly = await hourlyRes.json();
    renderWeatherAll(fcst.properties.periods, hourly.properties.periods);
    $('all-weather-updated').textContent = `Updated ${fmtTime(new Date())}`;
  } catch(e) {
    $('all-weather-body').innerHTML = `<div class="empty">Weather unavailable<br><small>${e.message}</small></div>`;
  }
}

function renderWeatherAll(periods, hourly) {
  if (!periods || !periods.length) return;
  const now = periods[0];
  const today = periods.slice(0, 8);
  const days = [];
  for (let i = 0; i < periods.length - 1; i += 2) {
    days.push({ day: periods[i], night: periods[i+1] });
    if (days.length >= 7) break;
  }

  // ── All-tab weather widget ──────────────────────────
  const h = hourly ? hourly.slice(0,1)[0] : null;
  const wind = now.windSpeed || '';
  const windDir = now.windDirection || '';
  $('all-weather-body').innerHTML = `
    <div class="weather-current">
      <div class="weather-icon">${wxIcon(now.shortForecast)}</div>
      <div>
        <div class="weather-temp">${now.temperature}°${now.temperatureUnit}</div>
        <div class="weather-desc">${now.shortForecast}</div>
        <div class="weather-detail">Wind: <span>${windDir} ${wind}</span> &nbsp; Humidity: <span>${h?.relativeHumidity?.value ?? '—'}%</span></div>
        <div class="weather-detail">Dewpoint: <span>${h?.dewpoint?.value != null ? Math.round(h.dewpoint.value * 9/5 + 32) + '°F' : '—'}</span></div>
      </div>
    </div>
    <div class="weather-forecast">
      ${today.slice(0,5).map(p => `
        <div class="forecast-period">
          <div class="fp-name">${p.name.substring(0,4)}</div>
          <div class="fp-icon">${wxIcon(p.shortForecast)}</div>
          <div class="fp-hi">${p.temperature}°</div>
        </div>`).join('')}
    </div>`;

  // ── Full weather tab ────────────────────────────────
  $('wx-now-body').innerHTML = `
    <div style="text-align:center;padding:20px 0">
      <div style="font-size:64px">${wxIcon(now.shortForecast)}</div>
      <div class="temp-big">${now.temperature}°${now.temperatureUnit}</div>
      <div style="font-size:14px;color:var(--text2);margin-top:6px">${now.shortForecast}</div>
    </div>
    <div class="conditions-row">
      <div class="cond-item"><div class="cond-val">${windDir} ${wind}</div><div class="cond-lbl">Wind</div></div>
      <div class="cond-item"><div class="cond-val">${h?.relativeHumidity?.value ?? '—'}%</div><div class="cond-lbl">Humidity</div></div>
      <div class="cond-item"><div class="cond-val">${now.isDaytime ? '☀️ Day' : '🌙 Night'}</div><div class="cond-lbl">Period</div></div>
    </div>
    <div style="padding:12px 0;font-size:12px;color:var(--text2);line-height:1.5">${now.detailedForecast}</div>`;

  $('wx-forecast-body').innerHTML = `<div class="forecast-row">
    ${days.map(({day, night}) => `
      <div class="forecast-day">
        <div class="fd-name">${(day.name||'').substring(0,3)}</div>
        <div class="fd-icon">${wxIcon(day.shortForecast)}</div>
        <div class="fd-hi">${day.temperature}°</div>
        <div class="fd-lo">${night?.temperature ?? '—'}°</div>
        <div class="fd-desc">${day.shortForecast}</div>
      </div>`).join('')}
  </div>`;
}

// ─── NWS ALERTS ─────────────────────────────────────────────────
async function fetchAlerts() {
  try {
    const r = await fetch(`https://api.weather.gov/alerts/active?zone=${CFG.nwsZone}`);
    const d = await r.json();
    const alerts = d.features || [];
    renderAlerts(alerts);
    return alerts;
  } catch(e) {
    $('all-alerts-body').innerHTML = `<div class="empty">Alerts unavailable</div>`;
    return [];
  }
}

function renderAlerts(alerts) {
  const count = alerts.length;
  const badge = $('alert-count-badge');
  if (badge) {
    badge.textContent = `${count} active`;
    badge.className = `badge ${count > 0 ? 'badge-warn' : 'badge-ok'}`;
  }

  const body = $('all-alerts-body');
  const wxBody = $('wx-alerts-body');

  if (!count) {
    const ok = `<div class="no-alerts"><i class="fas fa-circle-check" style="font-size:20px;display:block;margin-bottom:8px"></i>No active weather alerts<br><small style="color:var(--text3)">Westchester County</small></div>`;
    if (body) body.innerHTML = ok;
    if (wxBody) wxBody.innerHTML = ok;
    return;
  }

  const html = alerts.map(a => {
    const p = a.properties;
    const sev = p.severity || '';
    const dot = sev === 'Extreme' ? 'red' : sev === 'Severe' ? 'red' : sev === 'Moderate' ? 'orange' : 'blue';
    return `<div class="alert-item">
      <div class="alert-dot ${dot}"></div>
      <div class="alert-content">
        <div class="alert-title">${p.event || 'Alert'}</div>
        <div class="alert-sub">${p.headline || p.description?.substring(0,80) || ''}</div>
        <div class="alert-sub" style="margin-top:2px">Until: ${fmtDate(p.expires)}</div>
      </div>
    </div>`;
  }).join('');

  if (body) body.innerHTML = html;
  if (wxBody) wxBody.innerHTML = `<div style="padding:12px 14px">${html}</div>`;
}

// ─── USGS EARTHQUAKES ───────────────────────────────────────────
async function fetchUSGS() {
  try {
    const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&latitude=${CFG.lat}&longitude=${CFG.lon}&maxradiuskm=400&orderby=time&limit=8&minmagnitude=1`;
    const r = await fetch(url);
    const d = await r.json();
    const quakes = d.features || [];
    const body = $('wx-usgs-body');
    if (!body) return;
    if (!quakes.length) { body.innerHTML = `<div class="empty">No significant seismic activity nearby</div>`; return; }
    body.innerHTML = quakes.map(q => {
      const p = q.properties;
      const mag = p.mag?.toFixed(1) || '?';
      const color = p.mag >= 4 ? 'var(--bad)' : p.mag >= 2.5 ? 'var(--warn)' : 'var(--text3)';
      return `<div class="alert-item">
        <div class="alert-dot" style="background:${color};box-shadow:0 0 6px ${color}"></div>
        <div class="alert-content">
          <div class="alert-title">M${mag} — ${p.place}</div>
          <div class="alert-sub">${timeAgo(p.time)} · Depth: ${q.geometry.coordinates[2]?.toFixed(0) ?? '?'}km</div>
        </div>
      </div>`;
    }).join('');
  } catch(e) { /* silent */ }
}

// ─── AIRCRAFT (OPENSKY) ─────────────────────────────────────────
async function fetchAircraft() {
  try {
    const hasServer = await checkServer();
    const b = CFG.openSkyBounds;
    const url = hasServer
      ? '/api/aircraft'
      : `https://opensky-network.org/api/states/all?lamin=${b.lamin}&lomin=${b.lomin}&lamax=${b.lamax}&lomax=${b.lomax}`;
    const r = await fetch(url);
    if (r.status === 429 || r.status === 503) {
      $('aviation-count') && ($('aviation-count').textContent = `rate limited — retry in 10 min`);
      const el = $('all-aircraft-body');
      if (el && !allAircraft.length) el.innerHTML = `<div class="empty">OpenSky rate limit reached<br><small>Will retry automatically in 10 min</small></div>`;
      const tbody = $('aircraft-tbody');
      if (tbody && !allAircraft.length) tbody.innerHTML = `<tr><td colspan="9" class="empty">Rate limited — showing cached data if available</td></tr>`;
      return; // keep existing allAircraft data on screen if we have it
    }
    if (r.status === 401 || r.status === 403) {
      const el = $('all-aircraft-body');
      if (el) el.innerHTML = `<div class="empty">OpenSky access denied (${r.status})<br><small>Free anonymous access may be restricted — <a href="https://opensky-network.org/login" target="_blank" style="color:var(--c-aviation)">create a free account ↗</a></small></div>`;
      $('aviation-count') && ($('aviation-count').textContent = `access denied`);
      return;
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    allAircraft = (d.states || []).filter(s => s[5] && s[6]); // must have lon/lat
    renderAircraft(allAircraft);
  } catch(e) {
    const el = $('all-aircraft-body');
    if (el) el.innerHTML = `<div class="empty">OpenSky unavailable<br><small>${e.message}</small></div>`;
    const tbody = $('aircraft-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="empty">Data unavailable — ${e.message}</td></tr>`;
  }
}

function renderAircraft(states) {
  const count = states.length;
  $('aviation-count') && ($('aviation-count').textContent = `${count} aircraft`);

  // Clear old markers
  aircraftMarkers.forEach(m => m.remove());
  aircraftMarkers = [];

  // Compact widget for All tab
  const preview = $('all-aircraft-body');
  if (preview) {
    preview.innerHTML = `
      <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:8px">
        <div class="aircraft-count">${count}</div>
        <div class="aircraft-label">aircraft overhead</div>
      </div>
      <ul class="aircraft-list">
        ${states.slice(0, 6).map(s => {
          const callsign = (s[1] || '').trim() || s[0] || '????';
          const alt = s[7] ? `${m2ft(s[7])}ft` : s[13] ? `${m2ft(s[13])}ft` : '—';
          const spd = s[9] ? `${ms2mph(s[9])}mph` : '—';
          const hdg = s[10] ? `${Math.round(s[10])}°` : '—';
          return `<li>
            <span class="callsign">${callsign}</span>
            <span><div class="ac-lbl">Alt</div><div class="ac-val">${alt}</div></span>
            <span><div class="ac-lbl">Speed</div><div class="ac-val">${spd}</div></span>
            <span><div class="ac-lbl">Hdg</div><div class="ac-val">${hdg}</div></span>
          </li>`;
        }).join('')}
        ${count === 0 ? '<li class="empty">No aircraft detected</li>' : ''}
      </ul>`;
  }

  // Full aircraft table
  const tbody = $('aircraft-tbody');
  if (tbody) {
    tbody.innerHTML = states.slice(0, 50).map(s => {
      const callsign = (s[1] || '').trim() || '—';
      const icao = s[0] || '—';
      const alt  = s[7] != null ? `${m2ft(s[7])}ft` : (s[13] != null ? `${m2ft(s[13])}ft gnd` : '—');
      const spd  = s[9] != null ? `${ms2mph(s[9])}mph` : '—';
      const hdg  = s[10] != null ? `${Math.round(s[10])}° ${degToCard(s[10])}` : '—';
      const country = s[2] || '—';
      return `<tr>
        <td class="ac-callsign">${callsign}</td>
        <td style="font-family:monospace;font-size:10px;color:var(--text3)">${icao}</td>
        <td>—</td>
        <td>${alt}</td><td>${spd}</td><td>${hdg}</td>
        <td>—</td><td>—</td><td>${country}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="9" class="empty">No aircraft in range</td></tr>`;
  }

  // Map markers
  const planeIcon = L.divIcon({
    html: `<div style="font-size:18px;transform:rotate(0deg)">✈</div>`,
    className: '', iconSize: [22, 22], iconAnchor: [11, 11]
  });
  states.slice(0, 100).forEach(s => {
    if (!s[5] || !s[6]) return;
    const [lon, lat] = [s[5], s[6]];
    const callsign = (s[1] || s[0] || '').trim();
    const hdg = s[10] || 0;
    const icon = L.divIcon({
      html: `<div style="font-size:16px;transform:rotate(${hdg}deg);color:#a78bfa">✈</div>`,
      className: '', iconSize: [20,20], iconAnchor: [10,10]
    });
    const marker = L.marker([lat, lon], { icon })
      .bindPopup(`<b>${callsign}</b><br>ICAO: ${s[0]}<br>Alt: ${s[7]?m2ft(s[7])+'ft':'—'}<br>Speed: ${s[9]?ms2mph(s[9])+'mph':'—'}<br>Country: ${s[2]||'—'}`)
      .addTo(maps.aviation);
    aircraftMarkers.push(marker);
  });
}

// ─── REDDIT ─────────────────────────────────────────────────────
async function fetchReddit() {
  const hasServer = await checkServer();
  try {
    let posts = [];
    if (hasServer) {
      // Server proxy avoids CORS preflight that kills the browser direct fetch
      const r = await fetch('/api/reddit?sub=Westchester');
      const d = await r.json();
      posts = d.posts || [];
    } else {
      // Direct fetch — no custom headers so no preflight, simpler CORS
      const r = await fetch('https://www.reddit.com/r/Westchester.json?limit=15&raw_json=1');
      const d = await r.json();
      posts = d.data?.children?.map(c => c.data) || [];
    }
    if (posts.length) {
      renderReddit(posts);
    } else {
      const el = $('reddit-list');
      if (el) el.innerHTML = `<li class="empty">No posts returned — <a href="https://reddit.com/r/Westchester" target="_blank" style="color:var(--c-community)">open Reddit ↗</a></li>`;
    }
  } catch(e) {
    const el = $('reddit-list');
    if (el) el.innerHTML = `<li class="empty">Reddit unavailable: ${e.message}</li>`;
  }
}

function renderReddit(posts) {
  const html = posts.slice(0, 12).map(p => `
    <li>
      <div class="reddit-title"><a href="https://reddit.com${p.permalink}" target="_blank" style="color:var(--text)">${p.title}</a></div>
      <div class="reddit-meta">
        <span class="reddit-score">▲ ${p.score}</span> &nbsp;
        ${p.num_comments} comments &nbsp; ${timeAgo(p.created_utc * 1000)}
      </div>
    </li>`).join('');
  const el = $('reddit-list');
  if (el) el.innerHTML = html || `<li class="empty">No posts found</li>`;

  // Populate All tab community widget (6 items, fills 3-column grid)
  const comm = $('all-community-body');
  if (comm) {
    comm.innerHTML = posts.slice(0, 6).map(p => `
      <div class="community-item">
        <div class="community-source">r/Westchester</div>
        <div class="community-title"><a href="https://reddit.com${p.permalink}" target="_blank" style="color:var(--text)">${p.title}</a></div>
        <div class="community-meta">▲ ${p.score} · ${timeAgo(p.created_utc * 1000)}</div>
      </div>`).join('');
  }
}

// ─── RSS NEWS ───────────────────────────────────────────────────
// Auto-detects local server; falls back to allorigins.win public CORS proxy
let _serverAvail = null;
async function checkServer() {
  if (_serverAvail !== null) return _serverAvail;
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 2000);
    await fetch('/api/ping', { signal: ctrl.signal });
    _serverAvail = true;
  } catch(e) { _serverAvail = false; }
  return _serverAvail;
}

function parseRSSClient(xml, sourceName) {
  const items = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
  blocks.slice(0, 12).forEach(block => {
    const get = tag => {
      const cdataRe = new RegExp('<' + tag + '[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/' + tag + '>', 'i');
      const plainRe = new RegExp('<' + tag + '[^>]*>([^<]{1,300})<\\/' + tag + '>', 'i');
      return (block.match(cdataRe) || block.match(plainRe) || [])[1]?.trim() || '';
    };
    const linkHref = (block.match(/<link[^>]+href="([^"]+)"/) || [])[1] || '';
    items.push({ title: get('title'), link: get('link') || linkHref || '#', date: get('pubDate') || get('published') || '', source: sourceName });
  });
  return items.filter(i => i.title);
}

async function fetchRSSOne(src) {
  const hasServer = await checkServer();
  if (hasServer) {
    const r = await fetch(`/api/rss?url=${encodeURIComponent(src.url)}`);
    const d = await r.json();
    return { sourceName: src.name, items: d.items || [] };
  }
  // Public CORS proxy fallback (no server needed)
  const r = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(src.url)}`);
  const d = await r.json();
  return { sourceName: src.name, items: parseRSSClient(d.contents || '', src.name) };
}

async function fetchNews() {
  const results = await Promise.allSettled(CFG.rssSources.map(src => fetchRSSOne(src)));
  const prevCount = allNews.length;
  allNews = [];
  const errors = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value?.items?.length) {
      r.value.items.forEach(item => allNews.push({ ...item, sourceName: r.value.sourceName }));
    } else if (r.status === 'rejected' || (r.status === 'fulfilled' && !r.value?.items?.length)) {
      errors.push(CFG.rssSources[i].name);
    }
  });
  allNews.sort((a, b) => new Date(b.date) - new Date(a.date));
  if (!allNews.length && errors.length) {
    const newsGrid = $('all-news-body');
    if (newsGrid) newsGrid.innerHTML = `<div class="empty" style="grid-column:1/-1">News feeds unavailable (${errors.join(', ')})<br><small>Server may need to be running — start start.bat</small></div>`;
    const commList = $('news-list-community');
    if (commList) commList.innerHTML = `<li class="empty">News unavailable: ${errors.join(', ')}</li>`;
    return;
  }
  renderNews();
  if (errors.length) console.warn('[News] Failed sources:', errors.join(', '));
}

function renderNews() {
  const newsGrid = $('all-news-body');
  if (newsGrid) {
    newsGrid.innerHTML = allNews.slice(0, 18).map(n => `
      <div class="news-card">
        <a href="${n.link}" target="_blank">
          <div class="news-card-source">${n.sourceName || n.source}</div>
          <div class="news-card-title">${n.title}</div>
          <div class="news-card-date">${n.date ? timeAgo(n.date) : ''}</div>
        </a>
      </div>`).join('') || `<div class="empty">No news loaded yet</div>`;
  }
  const commList = $('news-list-community');
  if (commList) {
    commList.innerHTML = allNews.slice(0, 12).map(n => `
      <li>
        <div class="community-source">${n.sourceName || n.source}</div>
        <div class="reddit-title"><a href="${n.link}" target="_blank" style="color:var(--text)">${n.title}</a></div>
        <div class="reddit-meta">${n.date ? timeAgo(n.date) : ''}</div>
      </li>`).join('') || `<li class="empty">No news available</li>`;
  }
}

// ─── EVENTS ─────────────────────────────────────────────────────
async function fetchEvents() {
  const hasServer = await checkServer();
  let events = [];

  // 1. Try village calendars via server (most reliable local source)
  if (hasServer) {
    const [elms, tarr] = await Promise.allSettled([
      fetch('/api/calendar/elmsford').then(r => r.json()),
      fetch('/api/calendar/tarrytown').then(r => r.json())
    ]);
    if (elms.status === 'fulfilled') {
      calendarData.elmsford = elms.value.events || [];
      calendarData.elmsford.forEach(e => events.push({ ...e, category: 'community', source: 'Elmsford Village' }));
    }
    if (tarr.status === 'fulfilled') {
      calendarData.tarrytown = tarr.value.events || [];
      calendarData.tarrytown.forEach(e => events.push({ ...e, category: 'community', source: 'Tarrytown Village' }));
    }
  }

  // 2. Try Eventbrite public RSS for Westchester (no API key needed)
  try {
    const ebUrl = 'https://www.eventbrite.com/d/ny--westchester/events/?format=rss';
    const proxyUrl = hasServer
      ? `/api/rss?url=${encodeURIComponent(ebUrl)}`
      : `https://api.allorigins.win/raw?url=${encodeURIComponent(ebUrl)}`;
    const r = await fetch(proxyUrl);
    const text = await r.text();
    const items = parseRSSClient ? parseRSSClient(text, 'Eventbrite') : [];
    items.slice(0, 8).forEach(i => {
      if (i.title) events.push({ title: i.title, link: i.link, date: i.date ? fmtDate(i.date) : 'Upcoming', venue: 'Westchester', source: 'Eventbrite', category: guessCategory(i.title) });
    });
  } catch(e) { /* eventbrite optional */ }

  // 3. Standing local events (always visible; no API needed)
  const standing = [
    { title: 'Tarrytown Farmers Market', date: 'Every Sunday', venue: 'Patriots Park, Tarrytown', source: 'Village Calendar', category: 'family', link: 'https://www.tarrytownny.gov' },
    { title: 'Sleepy Hollow Walking Tours', date: 'Fridays & Saturdays', venue: 'Sleepy Hollow', source: 'sleepyhollowny.gov', category: 'arts', link: 'https://www.sleepyhollowny.gov' },
    { title: 'Westchester Community Events', date: 'See calendar', venue: 'Westchester County', source: 'westchestergov.com', category: 'community', link: 'https://www.westchestergov.com/community' },
  ];
  standing.forEach(e => events.push(e));

  allEvents = events.length ? events : standing; // fallback to standing if everything failed
  renderCalendars(); // sync village calendar panels too
  renderEventsGrid();

  // Weekend preview on All tab
  const preview = $('all-events-body');
  if (preview) {
    const show = allEvents.slice(0, 4);
    if (!show.length) { preview.innerHTML = `<div class="empty">No events loaded</div>`; return; }
    preview.innerHTML = show.map(e => `
      <div class="event-item">
        <div class="event-dot"></div>
        <div>
          <div class="event-title">${e.title}</div>
          <div class="event-meta">${e.date || 'Upcoming'} · ${e.venue || ''}</div>
          <div class="event-meta" style="color:var(--c-events)">${e.source}</div>
        </div>
      </div>`).join('');
  }
}

function guessCategory(title) {
  const t = (title || '').toLowerCase();
  if (/music|jazz|concert|band|sing|fest.*music/i.test(t)) return 'music';
  if (/wine|food|beer|cider|taste|culinary|dinner/i.test(t)) return 'food';
  if (/art|exhibit|gallery|theater|film|show|craft/i.test(t)) return 'arts';
  if (/kid|family|child|youth|parade|fair/i.test(t)) return 'family';
  return 'community';
}

function renderEventsGrid() {
  const grid = $('events-grid-body');
  if (!grid) return;
  const filtered = activeEventFilter === 'all'
    ? allEvents
    : allEvents.filter(e => e.category === activeEventFilter || (activeEventFilter === 'weekend' && /weekend|sat|sun/i.test(e.date)));
  grid.innerHTML = filtered.map(e => `
    <div class="event-card">
      <a href="${e.link}" target="_blank">
        <div class="event-card-body">
          <div class="event-card-date">${e.date}</div>
          <div class="event-card-title">${e.title}</div>
          <div class="event-card-venue"><i class="fas fa-location-dot" style="font-size:9px"></i> ${e.venue}</div>
          <div class="event-card-source">${e.source}</div>
        </div>
      </a>
    </div>`).join('') || `<div class="empty">No events found for this filter</div>`;
}

// ─── VILLAGE CALENDARS ──────────────────────────────────────────
async function fetchCalendars() {
  const hasServer = await checkServer();
  if (!hasServer) { renderCalendars(); return; } // show placeholder links
  const [elms, tarr] = await Promise.allSettled([
    fetch('/api/calendar/elmsford').then(r => r.json()),
    fetch('/api/calendar/tarrytown').then(r => r.json())
  ]);
  calendarData.elmsford  = elms.status  === 'fulfilled' ? (elms.value.events  || []) : [];
  calendarData.tarrytown = tarr.status  === 'fulfilled' ? (tarr.value.events  || []) : [];
  renderCalendars();
}

function renderCalendars() {
  const targets = [
    ['cal-elmsford-body',    calendarData.elmsford,  'elmsford.gov'],
    ['cal-tarrytown-body',   calendarData.tarrytown, 'tarrytownny.gov'],
    ['cal-elmsford-comm',    calendarData.elmsford,  'elmsford.gov'],
    ['cal-tarrytown-comm',   calendarData.tarrytown, 'tarrytownny.gov'],
  ];
  targets.forEach(([id, data, site]) => {
    const el = $(id);
    if (!el) return;
    const tag = id.includes('body') ? 'div' : 'ul';
    if (!data.length) {
      el.innerHTML = `<div class="empty">No events scraped — <a href="https://${site}" target="_blank" style="color:var(--c-events)">${site} ↗</a></div>`;
      return;
    }
    el.innerHTML = data.map(e => `
      <li class="cal-item">
        <div class="cal-title"><a href="${e.link || '#'}" target="_blank" style="color:var(--text)">${e.title}</a></div>
      </li>`).join('');
  });
}

// ─── CRIMES (SPOTCRIME) ─────────────────────────────────────────
async function fetchCrimes() {
  const hasServer = await checkServer();
  if (!hasServer) {
    const msg = `<div class="empty" style="padding:20px">
      Crime data requires the local server.<br>
      <a href="https://spotcrime.com/?lat=41.0534&lon=-73.8196" target="_blank" style="color:var(--c-crimes)">View SpotCrime directly ↗</a>
    </div>`;
    const lb = $('crimes-list-body'); if (lb) lb.innerHTML = msg;
    return;
  }
  try {
    const r = await fetch('/api/crimes');
    const d = await r.json();
    if (d.error && (!d.crimes || d.crimes.length === 0)) {
      const lb = $('crimes-list-body');
      if (lb) lb.innerHTML = `<div class="empty">SpotCrime unavailable (${d.error})<br>
        <a href="https://spotcrime.com/ny/westchester/elmsford" target="_blank" style="color:var(--c-crimes)">View SpotCrime directly ↗</a></div>`;
      return;
    }
    renderCrimes(d.crimes || []);
  } catch(e) {
    const lb = $('crimes-list-body');
    if (lb) lb.innerHTML = `<div class="empty">Crime data unavailable<br><a href="https://spotcrime.com/ny/westchester/elmsford" target="_blank" style="color:var(--c-crimes)">SpotCrime ↗</a></div>`;
  }
}

function renderCrimes(crimes) {
  // Stats
  let violent = 0, property = 0, other = 0;
  crimes.forEach(c => {
    const t = (c.type || '').toLowerCase();
    if (t.includes('assault') || t.includes('robbery') || t.includes('shoot')) violent++;
    else if (t.includes('theft') || t.includes('burglary') || t.includes('larceny')) property++;
    else other++;
  });
  $('crime-total')    && ($('crime-total').textContent    = crimes.length);
  $('crime-violent')  && ($('crime-violent').textContent  = violent);
  $('crime-property') && ($('crime-property').textContent = property);
  $('crime-other')    && ($('crime-other').textContent    = other);

  const listBody = $('crimes-list-body');
  if (listBody) {
    listBody.innerHTML = crimes.slice(0, 20).map(c => `
      <div class="crime-item">
        <div class="crime-type-dot" style="background:${crimeColor(c.type)}"></div>
        <div>
          <div class="crime-item-type">${c.type || 'Unknown'}</div>
          <div class="crime-item-address">${c.address || '—'}</div>
          <div class="crime-item-date">${fmtDate(c.date) || '—'}</div>
        </div>
      </div>`).join('') || `<div class="empty">No recent crimes reported nearby</div>`;
  }
}

// ─── SERVICES ───────────────────────────────────────────────────
// ─── WAZE TRAFFIC INCIDENTS ─────────────────────────────────────
const WAZE_ALERT_TYPES = {
  ACCIDENT:    { icon: '💥', color: 'var(--bad)',       label: 'Accident' },
  ROAD_CLOSED: { icon: '🚧', color: 'var(--bad)',       label: 'Road Closed' },
  HAZARD:      { icon: '⚠️',  color: 'var(--warn)',      label: 'Hazard' },
  JAM:         { icon: '🚦', color: 'var(--warn)',      label: 'Traffic Jam' },
  POLICE:      { icon: '🚔', color: 'var(--c-transport)', label: 'Police' },
  WEATHERHAZARD: { icon: '🌧️', color: 'var(--c-weather)', label: 'Weather Hazard' },
};

async function fetchTrafficIncidents() {
  const body = $('traffic-incidents-body');
  if (!body) return;

  const hasServer = await checkServer();
  if (!hasServer) {
    body.innerHTML = `<div class="empty">Server offline — <a href="https://511ny.org" target="_blank" style="color:var(--c-transport)">511ny.org ↗</a></div>`;
    return;
  }

  try {
    const r  = await fetch('/api/traffic');
    const data = await r.json();
    if (data.error && !data.alerts && !data.jams) throw new Error(data.error);

    const alerts = (data.alerts || []);
    const jams   = (data.jams   || []).filter(j => (j.level || 0) >= 3); // only significant jams

    if (alerts.length === 0 && jams.length === 0) {
      body.innerHTML = `<div class="empty" style="color:var(--ok)">✓ No incidents reported in the area</div>`;
      return;
    }

    const renderAlert = a => {
      const info   = WAZE_ALERT_TYPES[a.type] || { icon: '⚠️', color: 'var(--text3)', label: a.type || 'Incident' };
      const sub    = a.subtype ? ' — ' + a.subtype.replace(/_/g,' ').toLowerCase() : '';
      const street = a.street || a.city || 'Unknown location';
      const ago    = a.pubMillis ? timeAgo(a.pubMillis) : '';
      return `<div style="display:flex;gap:10px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:15px;flex-shrink:0;margin-top:1px">${info.icon}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;color:${info.color}">${info.label}${sub}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${street}">${street}</div>
          ${ago ? `<div style="font-size:10px;color:var(--text3);margin-top:2px">${ago}</div>` : ''}
        </div>
      </div>`;
    };

    const renderJam = j => {
      const street = j.street || 'Unknown road';
      const speed  = j.speedKMH != null ? Math.round(j.speedKMH * 0.621) + ' mph' : '';
      const delay  = j.delay   ? Math.round(j.delay / 60) + 'min delay' : '';
      const col    = j.level >= 4 ? 'var(--bad)' : 'var(--warn)';
      return `<div style="display:flex;gap:10px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:15px;flex-shrink:0;margin-top:1px">🚦</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;color:${col}">Heavy Traffic — Level ${j.level}/5</div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${street}">${street}</div>
          ${speed||delay ? `<div style="font-size:10px;color:var(--text3);margin-top:2px">${[speed,delay].filter(Boolean).join(' · ')}</div>` : ''}
        </div>
      </div>`;
    };

    const items = [
      ...alerts.slice(0, 8).map(renderAlert),
      ...jams.slice(0, 4).map(renderJam)
    ];
    const extra = (alerts.length + jams.length) - items.length;

    body.innerHTML = `<div style="padding:4px 0">${items.join('')}</div>` +
      (extra > 0 ? `<div style="font-size:10px;color:var(--text3);padding:4px 0">+${extra} more — <a href="https://www.waze.com/live-map/" target="_blank" style="color:var(--c-transport)">open Waze ↗</a></div>` : '');

  } catch(e) {
    body.innerHTML = `<div class="empty">Waze data unavailable — <a href="https://www.waze.com/live-map/" target="_blank" style="color:var(--c-transport)">waze.com ↗</a></div>`;
  }
}

// ─── MTA METRO-NORTH STATUS ─────────────────────────────────────
const MTA_STATUS_COLORS = {
  'GOOD SERVICE':   { cls: 'ok',   label: 'Good Service',   color: 'var(--ok)' },
  'DELAYS':         { cls: 'bad',  label: 'Delays',         color: 'var(--bad)' },
  'PLANNED WORK':   { cls: 'warn', label: 'Planned Work',   color: 'var(--warn)' },
  'SERVICE CHANGE': { cls: 'warn', label: 'Service Change', color: 'var(--warn)' },
  'SUSPENDED':      { cls: 'bad',  label: 'Suspended',      color: 'var(--bad)' },
};

async function saveTransitKey() {
  const input = $('transit-key-input');
  const key   = input ? input.value.trim() : '';
  if (!key) return;
  try {
    await fetch('/api/transit/key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key })
    });
    const banner = $('transit-key-banner');
    if (banner) banner.style.display = 'none';
    fetchTransit();
  } catch(e) { alert('Failed to save key: ' + e.message); }
}

async function fetchTransit() {
  const body = $('transit-status-body');
  if (!body) return;

  const hasServer = await checkServer();
  if (!hasServer) {
    body.innerHTML = `<div class="empty">Server offline — <a href="https://new.mta.info/alerts" target="_blank" style="color:var(--c-transport)">MTA Alerts ↗</a></div>`;
    return;
  }

  try {
    const r    = await fetch('/api/transit');
    const data = await r.json();

    // Show key banner if no 511NY key configured yet
    if (data.needsKey) {
      const banner = $('transit-key-banner');
      if (banner) banner.style.display = 'block';
      body.innerHTML = `<div class="transit-item">
        <div class="transit-name" style="color:var(--text3)">Enter 511NY key above for live status</div>
        <div class="transit-sub"><a href="https://new.mta.info/alerts" target="_blank" style="color:var(--c-transport)">Check MTA directly ↗</a></div>
      </div>`;
      return;
    }

    if (data.error) console.error('[Transit] error:', data.error);

    const lines = data.metro_north || [];
    if (lines.length === 0) throw new Error(data.error || 'No line data returned');

    // Lines relevant to Elmsford — Hudson Line (Tarrytown) is the primary station
    const PRIORITY = ['Hudson', 'Harlem', 'New Haven', 'Port Jervis', 'Pascack Valley'];
    const sorted = [
      ...PRIORITY.map(n => lines.find(l => l.name === n)).filter(Boolean),
      ...lines.filter(l => !PRIORITY.includes(l.name))
    ];

    // Display names and route descriptions (Hudson = Tarrytown station)
    const LINE_DISPLAY = {
      'Hudson':         { label: 'Hudson Line', sub: 'Grand Central ↔ Tarrytown ↔ Poughkeepsie · Nearest: Tarrytown' },
      'Harlem':         { label: 'Harlem Line', sub: 'Grand Central ↔ Southeast' },
      'New Haven':      { label: 'New Haven Line', sub: 'Grand Central ↔ New Haven' },
      'Port Jervis':    { label: 'Port Jervis Line', sub: 'Hoboken ↔ Port Jervis' },
      'Pascack Valley': { label: 'Pascack Valley Line', sub: 'Hoboken ↔ Spring Valley' },
    };

    body.innerHTML = sorted.map(line => {
      const info    = MTA_STATUS_COLORS[line.status] || { cls: 'warn', label: line.status || '—', color: 'var(--text3)' };
      const display = LINE_DISPLAY[line.name] || { label: line.name + ' Line', sub: '' };
      const note    = line.text && line.status !== 'GOOD SERVICE' ? line.text.substring(0, 140) : '';
      const isPrimary = line.name === 'Hudson';
      return `<div class="transit-item" ${isPrimary ? 'style="border-left:2px solid var(--c-transport);padding-left:8px"' : ''}>
        <div class="transit-name">${display.label} &nbsp;<span class="transit-badge ${info.cls}">${info.label}</span></div>
        ${display.sub ? `<div class="transit-sub">${display.sub}</div>` : ''}
        ${note ? `<div class="transit-sub" style="color:var(--warn);margin-top:3px;font-size:10px">${note}</div>` : ''}
      </div>`;
    }).join('') +
    `<div style="margin-top:8px"><a href="https://new.mta.info/alerts" target="_blank" style="font-size:11px;color:var(--c-transport)">MTA Alerts ↗</a></div>`;

  } catch(e) {
    body.innerHTML = `<div class="transit-item">
      <div class="transit-name">Status unavailable</div>
      <div class="transit-sub"><a href="https://new.mta.info/alerts" target="_blank" style="color:var(--c-transport)">Check MTA directly ↗</a></div>
    </div>`;
  }
}

const SERVICE_ICONS = {
  'ConEdison': '⚡', 'Comcast / Xfinity': '📡', 'Verizon Wireless': '📱',
  'National Grid': '🔥', 'SUEZ Water': '💧'
};

async function fetchServices() {
  const hasServer = await checkServer();
  if (!hasServer) {
    // Show quick-link chips when no server
    servicesData = [
      { name:'ConEdison',       icon:'⚡', status:'unknown', detail:'Click to check', link:'https://outagemap.coned.com/' },
      { name:'Comcast/Xfinity', icon:'📡', status:'unknown', detail:'Click to check', link:'https://www.xfinity.com/support/status' },
      { name:'Verizon Wireless',icon:'📱', status:'unknown', detail:'Click to check', link:'https://www.verizon.com/support/network-status/' },
      { name:'National Grid',   icon:'🔥', status:'unknown', detail:'Click to check', link:'https://www.nationalgridus.com/our-services/managing-an-outage/outage-central' },
      { name:'SUEZ Water',      icon:'💧', status:'unknown', detail:'Click to check', link:'https://www.mysuezwater.com/outage-status' },
    ];
    renderServices();
    const lc = $('services-last-checked');
    if (lc) lc.textContent = 'Live status needs server — click to check manually';
    return;
  }
  try {
    const r = await fetch('/api/services/all');
    servicesData = await r.json();
    renderServices();
    const lc = $('services-last-checked');
    if (lc) lc.textContent = `Last checked ${fmtTime(new Date())}`;
  } catch(e) {
    const sc = $('services-chips');
    if (sc) sc.innerHTML = `<div class="empty">Services unavailable</div>`;
  }
}

function renderServices() {
  // Compact chips for All tab
  const chips = $('services-chips');
  if (chips) {
    chips.innerHTML = servicesData.map(s => {
      const cls = statusColor(s.status);
      return `<div class="service-chip">
        <a href="${s.link}" target="_blank">
          <div class="svc-dot ${cls}"></div>
          <div>
            <div class="svc-name">${SERVICE_ICONS[s.name] || '🔌'} ${s.name}</div>
            <div class="svc-status">${statusText(s.status)}</div>
          </div>
        </a>
      </div>`;
    }).join('');
  }

  // Full cards for Services tab
  const cards = $('services-cards-body');
  if (cards) {
    cards.innerHTML = servicesData.map(s => {
      const cls = statusColor(s.status);
      return `<div class="panel service-card">
        <div class="service-card-header">
          <div class="service-card-icon">${SERVICE_ICONS[s.name] || '🔌'}</div>
          <div>
            <div class="service-card-name">${s.name}</div>
            <div class="service-card-status-text ${cls}">${statusText(s.status)}</div>
          </div>
          <div style="margin-left:auto"><div class="status-dot-large svc-dot ${cls}"></div></div>
        </div>
        <div class="service-card-body">
          <div>${s.detail || '—'}</div>
          ${s.incidents != null ? `<div class="service-incidents">Incidents: <span>${s.incidents}</span>${s.customersAffected ? ` · ${s.customersAffected} customers affected` : ''}</div>` : ''}
          <a class="service-card-link" href="${s.link}" target="_blank"><i class="fas fa-arrow-up-right-from-square"></i> Check status</a>
        </div>
      </div>`;
    }).join('');
  }

  // Update header badges for any outages
  updateHeaderBadges();
}

// ─── HEADER BADGES ──────────────────────────────────────────────
function updateHeaderBadges() {
  const outages = servicesData.filter(s => s.status === 'outage').length;
  const degraded = servicesData.filter(s => s.status === 'degraded').length;
  const badges = $('header-badges');
  if (!badges) return;
  let html = '';
  if (outages) html += `<span class="badge badge-bad"><i class="fas fa-bolt"></i> ${outages} Outage${outages > 1 ? 's' : ''}</span>`;
  if (degraded) html += `<span class="badge badge-warn"><i class="fas fa-triangle-exclamation"></i> ${degraded} Service Issue${degraded > 1 ? 's' : ''}</span>`;
  if (!outages && !degraded && servicesData.length) html += `<span class="badge badge-ok"><i class="fas fa-circle-check"></i> All Services OK</span>`;
  badges.innerHTML = html;
}

// ─── AIS / MARINE (aisstream.io) ────────────────────────────────
const AIS_KEY_STORAGE = 'ais_api_key';
const AIS_WS_URL = 'wss://stream.aisstream.io/v0/stream';
// Hudson River bounding box: [SW_lat, SW_lon], [NE_lat, NE_lon]
const AIS_BOUNDS = [[40.55, -74.10], [41.55, -73.85]];

let aisSocket = null;
let vesselMap = {};         // MMSI → vessel data
let vesselMarkers = {};     // MMSI → Leaflet marker
let aisConnected = false;

const VESSEL_TYPES = {
  // Ranges → label + css class
  cargo:     { range: [[70,79]], label: 'Cargo',     cls: 'cargo',     icon: '🚢' },
  tanker:    { range: [[80,89]], label: 'Tanker',    cls: 'tanker',    icon: '🛢️' },
  passenger: { range: [[60,69]], label: 'Passenger', cls: 'passenger', icon: '⛴️' },
  sailing:   { range: [[36,36]], label: 'Sailing',   cls: 'sailing',   icon: '⛵' },
  pleasure:  { range: [[37,37]], label: 'Pleasure',  cls: 'pleasure',  icon: '🚤' },
  tug:       { range: [[21,22],[31,32]], label: 'Tug/Tow', cls: 'tug', icon: '🚢' },
};

function getVesselType(typeCode) {
  if (!typeCode) return { label: 'Unknown', cls: 'other', icon: '⚓' };
  for (const [key, vt] of Object.entries(VESSEL_TYPES)) {
    for (const [lo, hi] of vt.range) {
      if (typeCode >= lo && typeCode <= hi) return vt;
    }
  }
  return { label: `Type ${typeCode}`, cls: 'other', icon: '⚓' };
}

const NAV_STATUS = {
  0: 'Underway', 1: 'Anchored', 2: 'Not under command', 3: 'Restricted maneuverability',
  4: 'Constrained by draught', 5: 'Moored', 6: 'Aground', 7: 'Fishing',
  8: 'Sailing', 15: 'Not defined'
};

function getAISKey() {
  return localStorage.getItem(AIS_KEY_STORAGE) || '';
}

function saveAISKey() {
  const input = $('ais-key-input');
  if (!input || !input.value.trim()) return;
  const key = input.value.trim();
  localStorage.setItem(AIS_KEY_STORAGE, key);
  const banner = $('ais-key-banner');
  if (banner) banner.style.display = 'none';

  if (_aisUsingProxy) {
    // Send key to server proxy
    fetch('/api/ais/key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key })
    }).then(() => {
      setAISStatus('connecting');
      setAISDebug('Server proxy connecting…');
    }).catch(() => connectAIS()); // server fell over — use direct WS
  } else {
    connectAIS();
  }
}

function setAISStatus(state) {
  // state: 'live' | 'connecting' | 'off'
  aisConnected = state === 'live';
  const dot  = $('ais-status-dot');
  const text = $('ais-status-text');
  const meta = $('all-marine-meta');
  const states = {
    live:       { cls: 'ais-dot-live', label: 'Live · Hudson River' },
    connecting: { cls: 'ais-dot-wait', label: 'Connecting…' },
    off:        { cls: 'ais-dot-off',  label: 'Not connected' },
  };
  const s = states[state] || states.off;
  if (dot)  { dot.className = 'svc-dot ' + s.cls; }
  if (text) { text.textContent = s.label; }
  if (meta) { meta.textContent = s.label; }
}

// ─── AIS INIT (server proxy → direct WebSocket fallback) ─────────
let _aisUsingProxy = false;

async function initAIS() {
  const hasServer = await checkServer();

  if (hasServer) {
    _aisUsingProxy = true;

    // Ask server if it already has a key loaded (e.g. auto-loaded from config.json on restart)
    try {
      const statusRes = await fetch('/api/ais/key');
      const status = await statusRes.json();

      if (status.connected || (status.status && status.status !== 'off')) {
        // Server already has a live/connecting AIS proxy — just poll
        setAISStatus('connecting');
        setAISDebug('Server proxy active — polling…');
        pollAIS();
        setInterval(pollAIS, 30000);
        return;
      }
    } catch(e) { /* ignore — server might not respond to GET on /api/ais/key */ }

    // Server doesn't have a key yet — check localStorage
    const key = getAISKey();
    if (key) {
      try {
        await fetch('/api/ais/key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key })
        });
        setAISStatus('connecting');
        setAISDebug('Server proxy connecting…');
        pollAIS();
        setInterval(pollAIS, 30000);
        return;
      } catch(e) { /* fall through */ }
    }

    // No key anywhere — show banner (proxy mode, so saveAISKey will POST to server)
    const banner = $('ais-key-banner');
    if (banner) banner.style.display = 'block';
    setAISStatus('off');
    setAISDebug('Enter API key above to connect');
    return;
  }

  // No server — fall back to direct browser WebSocket
  // (Note: if the server isn't running, start start.bat for full proxy support)
  setAISDebug('No server — using direct WebSocket (restart start.bat for proxy mode)');
  connectAIS();
}

async function pollAIS() {
  try {
    const r = await fetch('/api/ais');
    if (!r.ok) return;
    const d = await r.json();

    // Sync vesselMap from server data
    const serverMMSIs = new Set();
    (d.vessels || []).forEach(v => {
      serverMMSIs.add(String(v.mmsi));
      vesselMap[v.mmsi] = v;
    });
    // Remove vessels no longer on server
    Object.keys(vesselMap).forEach(m => {
      if (!serverMMSIs.has(String(m))) {
        if (vesselMarkers[m]) { vesselMarkers[m].remove(); delete vesselMarkers[m]; }
        delete vesselMap[m];
      }
    });

    if (d.connected) {
      setAISStatus('live');
      setAISDebug(`Server proxy · ${d.count} vessel${d.count !== 1 ? 's' : ''}`);
    } else {
      setAISStatus('connecting');
      const detail = d.status && d.status.startsWith('error:') ? d.status.replace('error:', '') :
                     d.status && d.status.startsWith('closed:') ? `Reconnecting (${d.status.replace('closed:','code ')})` : 'Connecting…';
      setAISDebug(`Server proxy: ${detail}`);
    }

    syncVesselMarkers();
    updateMarineTable();
    updateMarinePreview();
    updateMarineStats();
  } catch(e) {
    setAISDebug(`Proxy poll error: ${e.message}`);
  }
}

function syncVesselMarkers() {
  if (!maps.marine) return;
  // Add/update markers for all known vessels
  Object.keys(vesselMap).forEach(mmsi => updateVesselMarker(mmsi));
  // Remove markers for purged vessels
  Object.keys(vesselMarkers).forEach(mmsi => {
    if (!vesselMap[mmsi]) { vesselMarkers[mmsi].remove(); delete vesselMarkers[mmsi]; }
  });
}

let _aisConnectTimer = null;

function connectAIS() {
  const key = getAISKey();
  if (!key) {
    const banner = $('ais-key-banner');
    if (banner) banner.style.display = 'block';
    setAISStatus('off');
    const body = $('all-marine-body');
    if (body) body.innerHTML = `<div class="empty" style="padding:16px">
      Get a free API key at <a href="https://aisstream.io" target="_blank" style="color:var(--c-marine)">aisstream.io</a>
      then enter it in the Marine tab to enable live vessel tracking.
    </div>`;
    const tbody = $('marine-vessel-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="empty">Enter your aisstream.io API key above to begin</td></tr>`;
    return;
  }

  // Close existing socket if any
  if (aisSocket) { try { aisSocket.close(); } catch(e) {} aisSocket = null; }
  if (_aisConnectTimer) { clearTimeout(_aisConnectTimer); _aisConnectTimer = null; }

  setAISStatus('connecting');
  const keySnip = key.substring(0, 6) + '…';
  setAISDebug(`Connecting… (key: ${keySnip})`);
  console.log('[AIS] Connecting to', AIS_WS_URL, '— key prefix:', keySnip);

  // Timeout: if onopen hasn't fired in 12s the socket is probably blocked
  _aisConnectTimer = setTimeout(() => {
    if (aisSocket && aisSocket.readyState === WebSocket.CONNECTING) {
      setAISDebug('Timeout — WSS port may be blocked (firewall/VPN/antivirus). Retrying in 30s…');
      setAISStatus('off');
      console.warn('[AIS] Connection timeout after 12s — readyState:', aisSocket.readyState);
      try { aisSocket.close(); } catch(e) {}
      if (getAISKey()) setTimeout(connectAIS, 30000);
    }
  }, 12000);

  aisSocket = new WebSocket(AIS_WS_URL);

  aisSocket.onopen = () => {
    clearTimeout(_aisConnectTimer); _aisConnectTimer = null;
    // Send subscription — no FilterMessageTypes (not a valid aisstream.io field)
    const sub = { APIKey: key, BoundingBoxes: [AIS_BOUNDS] };
    aisSocket.send(JSON.stringify(sub));
    setAISStatus('live');
    setAISDebug(`Connected · Subscribed to Hudson River bounds`);
    console.log('[AIS] Subscription sent:', JSON.stringify(sub));
  };

  aisSocket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      // aisstream.io sends an error object if the key is invalid
      if (msg.error || msg.Error) {
        const err = msg.error || msg.Error;
        setAISDebug(`Server error: ${err}`);
        setAISStatus('off');
        console.error('[AIS] Server error:', err);
        return;
      }
      setAISDebug(`Live · Last msg: ${msg.MessageType || 'unknown'} · ${Object.keys(vesselMap).length} vessels`);
      processAISMessage(msg);
    } catch(e) {
      console.warn('[AIS] Parse error:', e, event.data?.substring(0, 100));
    }
  };

  aisSocket.onerror = (e) => {
    clearTimeout(_aisConnectTimer); _aisConnectTimer = null;
    setAISStatus('off');
    setAISDebug('WebSocket error — check F12 console for details');
    console.error('[AIS] WebSocket error event:', e);
  };

  aisSocket.onclose = (e) => {
    clearTimeout(_aisConnectTimer); _aisConnectTimer = null;
    setAISStatus('off');
    // Close code 1006 = abnormal closure (connection never established or dropped by network)
    // Close code 1000 = normal closure
    // Close code 4xxx = application-level (e.g. 4001 = bad API key on some servers)
    const reason = e.reason ? ` "${e.reason}"` : '';
    setAISDebug(`Closed code ${e.code}${reason} — reconnecting in 30s…`);
    console.warn('[AIS] Connection closed — code:', e.code, 'reason:', e.reason || '(none)', 'wasClean:', e.wasClean);
    if (getAISKey()) setTimeout(connectAIS, 30000);
  };
}

function setAISDebug(msg) {
  const el = $('ais-debug');
  if (el) el.textContent = msg;
  // Also update the status text
  const st = $('ais-status-text');
  if (st && !msg.startsWith('Live')) return; // only override if live
}

function processAISMessage(msg) {
  const meta = msg.MetaData || {};
  const mmsi = meta.MMSI || meta.UserID;
  if (!mmsi) return;

  const type = msg.MessageType;

  if (type === 'PositionReport' || type === 'StandardClassBPositionReport') {
    const pr = msg.Message?.PositionReport || msg.Message?.StandardClassBPositionReport || {};
    const lat = meta.latitude  || pr.Latitude;
    const lon = meta.longitude || pr.Longitude;
    if (!lat || !lon || lat === 0 || lon === 0) return;

    vesselMap[mmsi] = {
      ...vesselMap[mmsi],
      mmsi,
      name:    meta.ShipName?.trim() || vesselMap[mmsi]?.name || `MMSI ${mmsi}`,
      lat, lon,
      sog:     pr.Sog,         // speed over ground (knots)
      cog:     pr.Cog,         // course over ground
      heading: pr.TrueHeading,
      navStatus: pr.NavigationalStatus,
      lastSeen: Date.now(),
    };
    updateVesselMarker(mmsi);
  }

  if (type === 'ShipStaticData') {
    const sd = msg.Message?.ShipStaticData || {};
    vesselMap[mmsi] = {
      ...vesselMap[mmsi],
      mmsi,
      name:        (sd.Name || meta.ShipName || '').trim() || `MMSI ${mmsi}`,
      typeCode:    sd.Type,
      destination: (sd.Destination || '').trim(),
      callsign:    sd.CallSign,
      lastSeen:    Date.now(),
    };
  }

  updateMarineTable();
  updateMarinePreview();
  updateMarineStats();
}

function updateVesselMarker(mmsi) {
  const v = vesselMap[mmsi];
  if (!v || !v.lat || !v.lon || !maps.marine) return;
  const vt = getVesselType(v.typeCode);
  const hdg = v.heading && v.heading < 360 ? v.heading : (v.cog || 0);

  const icon = L.divIcon({
    html: `<div style="font-size:16px;transform:rotate(${hdg}deg);filter:drop-shadow(0 0 3px ${vesselIconColor(v.typeCode)})">${vt.icon}</div>`,
    className: '', iconSize: [22, 22], iconAnchor: [11, 11]
  });

  const popup = `<b>${v.name}</b><br>
    MMSI: ${v.mmsi}<br>
    Type: ${vt.label}<br>
    Speed: ${v.sog != null ? v.sog.toFixed(1) + ' kn' : '—'}<br>
    Heading: ${hdg ? Math.round(hdg) + '° ' + degToCard(hdg) : '—'}<br>
    Status: ${NAV_STATUS[v.navStatus] || '—'}<br>
    Destination: ${v.destination || '—'}`;

  if (vesselMarkers[mmsi]) {
    vesselMarkers[mmsi].setLatLng([v.lat, v.lon]).setIcon(icon).setPopupContent(popup);
  } else {
    vesselMarkers[mmsi] = L.marker([v.lat, v.lon], { icon })
      .bindPopup(popup)
      .addTo(maps.marine);
  }
}

function vesselIconColor(typeCode) {
  const vt = getVesselType(typeCode);
  const colors = { cargo:'#f59e0b', tanker:'#ef4444', passenger:'#06b6d4', sailing:'#34d399', pleasure:'#a78bfa', tug:'#fb923c', other:'#64748b' };
  return colors[vt.cls] || '#64748b';
}

function updateMarineTable() {
  const tbody = $('marine-vessel-tbody');
  if (!tbody) return;
  const vessels = Object.values(vesselMap).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  if (!vessels.length) { tbody.innerHTML = `<tr><td colspan="8" class="empty">No AIS vessels in Hudson River bounds right now — the river may be quiet, or start.bat needs to be running for server proxy mode</td></tr>`; return; }

  const lu = $('marine-last-update');
  if (lu) lu.textContent = `Updated ${fmtTime(new Date())} · ${vessels.length} vessel${vessels.length !== 1 ? 's' : ''}`;

  tbody.innerHTML = vessels.slice(0, 60).map(v => {
    const vt = getVesselType(v.typeCode);
    const hdg = v.heading && v.heading < 360 ? v.heading : v.cog;
    return `<tr>
      <td class="vessel-name"><span class="vessel-dot ${vt.cls}"></span>${v.name || '—'}</td>
      <td class="vessel-mmsi">${v.mmsi}</td>
      <td>${vt.icon} ${vt.label}</td>
      <td>${v.sog != null ? v.sog.toFixed(1) + ' kn' : '—'}</td>
      <td>${hdg ? Math.round(hdg) + '° ' + degToCard(hdg) : '—'}</td>
      <td style="font-size:10px;color:var(--text3)">${NAV_STATUS[v.navStatus] || '—'}</td>
      <td style="font-size:10px;color:var(--text2)">${v.destination || '—'}</td>
      <td style="font-size:10px;color:var(--text3)">${timeAgo(v.lastSeen)}</td>
    </tr>`;
  }).join('');
}

function updateMarinePreview() {
  const body = $('all-marine-body');
  if (!body) return;
  const vessels = Object.values(vesselMap).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  if (!vessels.length) { body.innerHTML = `<div class="empty">No vessels detected yet</div>`; return; }
  body.innerHTML = `
    <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:8px">
      <div class="aircraft-count" style="color:var(--c-marine)">${vessels.length}</div>
      <div class="aircraft-label">vessels on Hudson</div>
    </div>
    <ul class="aircraft-list">
      ${vessels.slice(0, 5).map(v => {
        const vt = getVesselType(v.typeCode);
        return `<li>
          <span class="callsign" style="color:var(--c-marine)">${v.name || '—'}</span>
          <span><div class="ac-lbl">Type</div><div class="ac-val">${vt.label}</div></span>
          <span><div class="ac-lbl">Speed</div><div class="ac-val">${v.sog != null ? v.sog.toFixed(1) + 'kn' : '—'}</div></span>
          <span><div class="ac-lbl">Dest</div><div class="ac-val" style="font-size:9px">${v.destination || '—'}</div></span>
        </li>`;
      }).join('')}
    </ul>`;
}

function updateMarineStats() {
  const vessels = Object.values(vesselMap);
  $('marine-vessel-count') && ($('marine-vessel-count').textContent = vessels.length);
  const counts = { cargo: 0, passenger: 0, pleasure: 0, other: 0 };
  vessels.forEach(v => {
    const vt = getVesselType(v.typeCode);
    if (vt.cls === 'cargo' || vt.cls === 'tanker') counts.cargo++;
    else if (vt.cls === 'passenger') counts.passenger++;
    else if (vt.cls === 'pleasure' || vt.cls === 'sailing') counts.pleasure++;
    else counts.other++;
  });
  $('marine-cargo-count')     && ($('marine-cargo-count').textContent     = counts.cargo);
  $('marine-passenger-count') && ($('marine-passenger-count').textContent = counts.passenger);
  $('marine-pleasure-count')  && ($('marine-pleasure-count').textContent  = counts.pleasure);
  $('marine-other-count')     && ($('marine-other-count').textContent     = counts.other);
}

// Purge vessels not seen in 10 minutes
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  Object.keys(vesselMap).forEach(mmsi => {
    if ((vesselMap[mmsi].lastSeen || 0) < cutoff) {
      if (vesselMarkers[mmsi]) { vesselMarkers[mmsi].remove(); delete vesselMarkers[mmsi]; }
      delete vesselMap[mmsi];
    }
  });
}, 60000);

// ─── INIT & REFRESH LOOPS ───────────────────────────────────────
async function init() {
  initTabs();
  initMaps();

  // Connect AIS — tries server proxy first, falls back to direct WebSocket
  initAIS();

  // Parallel load
  Promise.all([
    fetchWeather(),
    fetchAlerts(),
    fetchUSGS(),
    fetchAircraft(),
    fetchReddit(),
    fetchEvents(),
    fetchNews(),
    fetchCrimes(),
    fetchServices(),
    fetchTrafficIncidents(),
    fetchTransit(),
    // fetchCalendars() is now called inside fetchEvents() to keep them in sync
  ]);

  // Refresh timers
  setInterval(fetchWeather,           CFG.refresh.weather);
  setInterval(() => { fetchAlerts(); fetchUSGS(); }, CFG.refresh.alerts);
  setInterval(fetchAircraft,          CFG.refresh.aircraft);
  setInterval(fetchReddit,            CFG.refresh.community);
  setInterval(fetchServices,          CFG.refresh.services);
  setInterval(fetchNews,              CFG.refresh.community);
  setInterval(fetchTrafficIncidents,  5 * 60 * 1000);   // every 5 min
  setInterval(fetchTransit,          10 * 60 * 1000);   // every 10 min
}

document.addEventListener('DOMContentLoaded', init);
