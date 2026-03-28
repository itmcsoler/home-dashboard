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
    { name: 'lohud', url: 'https://www.lohud.com/arcio/rss/' },
    { name: 'Patch Elmsford', url: 'https://patch.com/new-york/elmsford/rss.xml' },
    { name: 'Patch Tarrytown', url: 'https://patch.com/new-york/tarrytown/rss.xml' },
    { name: 'Rivertowns', url: 'https://rivertownsenterprise.net/feed/' },
  ],
  refresh: {
    weather:   10 * 60 * 1000,
    alerts:     5 * 60 * 1000,
    aircraft:   60 * 1000,
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
  // Invalidate Leaflet maps when shown
  setTimeout(() => { Object.values(maps).forEach(m => { try { m.invalidateSize(); } catch(e){} }); }, 100);
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

  // Mini traffic map (All tab)
  maps.mini = L.map('mini-map', { zoomControl:false, scrollWheelZoom:false, dragging:false })
    .setView([CFG.lat, CFG.lon], 12);
  L.tileLayer(CFG.cartoTiles, tileOpts).addTo(maps.mini);
  L.circleMarker([CFG.lat, CFG.lon], { color:'#38bdf8', fillColor:'#38bdf8', fillOpacity:1, radius:7, weight:2 })
    .addTo(maps.mini).bindPopup('🏠 Home — 10523');

  // Transport map
  maps.transport = L.map('transport-map', { zoomControl:true })
    .setView([CFG.lat, CFG.lon], 11);
  L.tileLayer(CFG.cartoTiles, tileOpts).addTo(maps.transport);
  L.circleMarker([CFG.lat, CFG.lon], { color:'#fbbf24', fillColor:'#fbbf24', fillOpacity:1, radius:7 })
    .addTo(maps.transport).bindPopup('🏠 Home');

  // Crime map
  maps.crime = L.map('crime-map', { zoomControl:true })
    .setView([CFG.lat, CFG.lon], 13);
  L.tileLayer(CFG.cartoTiles, tileOpts).addTo(maps.crime);
  L.circleMarker([CFG.lat, CFG.lon], { color:'#38bdf8', fillColor:'#38bdf8', fillOpacity:1, radius:6 })
    .addTo(maps.crime).bindPopup('🏠 Home');

  // Aviation map
  maps.aviation = L.map('aviation-map', { zoomControl:true })
    .setView([CFG.lat, CFG.lon], 9);
  L.tileLayer(CFG.cartoTiles, tileOpts).addTo(maps.aviation);
  L.circleMarker([CFG.lat, CFG.lon], { color:'#38bdf8', fillColor:'#38bdf8', fillOpacity:1, radius:8, weight:2 })
    .addTo(maps.aviation).bindPopup('🏠 Home — 10523');

  // 25-mile radius circle on aviation map
  L.circle([CFG.lat, CFG.lon], { radius: 40234, color:'#a78bfa', fillColor:'#a78bfa', fillOpacity:0.04, dashArray:'6 4', weight:1 })
    .addTo(maps.aviation).bindPopup('25mi monitoring radius');
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
    const b = CFG.openSkyBounds;
    const url = `https://opensky-network.org/api/states/all?lamin=${b.lamin}&lomin=${b.lomin}&lamax=${b.lamax}&lomax=${b.lomax}`;
    const r = await fetch(url);
    const d = await r.json();
    allAircraft = (d.states || []).filter(s => s[5] && s[6]); // must have lon/lat
    renderAircraft(allAircraft);
  } catch(e) {
    $('all-aircraft-body').innerHTML = `<div class="empty">OpenSky unavailable<br><small>Rate limited — try again shortly</small></div>`;
    const tbody = $('aircraft-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="empty">Data unavailable</td></tr>`;
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
  try {
    const r = await fetch('https://www.reddit.com/r/Westchester.json?limit=15', {
      headers: { 'User-Agent': 'HomeDashboard/1.0' }
    });
    const d = await r.json();
    const posts = d.data?.children?.map(c => c.data) || [];
    renderReddit(posts);
  } catch(e) {
    const el = $('reddit-list');
    if (el) el.innerHTML = `<li class="empty">Reddit unavailable</li>`;
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

  // Also populate All tab community widget
  const comm = $('all-community-body');
  if (comm) {
    comm.innerHTML = posts.slice(0, 4).map(p => `
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
    setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch('/api/rss?url=test', { signal: ctrl.signal });
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
  allNews = [];
  results.forEach(r => {
    if (r.status === 'fulfilled' && r.value?.items) {
      r.value.items.forEach(item => allNews.push({ ...item, sourceName: r.value.sourceName }));
    }
  });
  allNews.sort((a, b) => new Date(b.date) - new Date(a.date));
  renderNews();
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

// ─── EVENTS (TICKETMASTER) ──────────────────────────────────────
async function fetchEvents() {
  // Try Ticketmaster (free API key required — using public discovery endpoint)
  const mockEvents = [
    { title: 'Sleepy Hollow Lantern Festival', date: 'This Weekend', venue: 'Sleepy Hollow Cemetery', source: 'Community', category: 'arts', link: '#' },
    { title: 'Hudson Valley Wine & Food Fest', date: 'Sat Oct 5', venue: 'Westchester County Center', source: 'Westchester.gov', category: 'food', link: '#' },
    { title: 'Tarrytown Farmers Market', date: 'Every Sunday', venue: 'Patriots Park, Tarrytown', source: 'Village Calendar', category: 'family', link: '#' },
    { title: 'Music on the Hudson', date: 'Fri–Sun', venue: 'Irvington Waterfront', source: 'Eventbrite', category: 'music', link: '#' },
    { title: 'Westchester County Fair', date: 'Sep 28–Oct 6', venue: 'Yonkers Raceway', source: 'Ticketmaster', category: 'family', link: '#' },
    { title: 'Halloween Parade — Tarrytown', date: 'Oct 26', venue: 'Downtown Tarrytown', source: 'Tarrytown Calendar', category: 'family', link: 'https://www.tarrytownny.gov' },
    { title: 'Jazz in the Park', date: 'Sun Oct 6', venue: 'Elmsford Town Park', source: 'Elmsford Calendar', category: 'music', link: 'https://www.elmsford.gov' },
    { title: 'Craft Beer & Cider Festival', date: 'Oct 12', venue: 'Cross County Mall Area', source: 'Eventbrite', category: 'food', link: '#' },
  ];
  allEvents = mockEvents;
  renderEventsGrid();

  // Weekend preview on All tab
  const preview = $('all-events-body');
  if (preview) {
    preview.innerHTML = mockEvents.slice(0, 4).map(e => `
      <div class="event-item">
        <div class="event-dot"></div>
        <div>
          <div class="event-title">${e.title}</div>
          <div class="event-meta">${e.date} · ${e.venue}</div>
          <div class="event-meta" style="color:var(--c-events)">${e.source}</div>
        </div>
      </div>`).join('');
  }
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
    renderCrimes(d.crimes || []);
  } catch(e) {
    const lb = $('crimes-list-body');
    if (lb) lb.innerHTML = `<div class="empty">Crime data unavailable<br><a href="https://spotcrime.com" target="_blank" style="color:var(--c-crimes)">SpotCrime ↗</a></div>`;
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

  // Clear old markers
  crimeMarkers.forEach(m => m.remove());
  crimeMarkers = [];

  // Map + list
  crimes.forEach(c => {
    if (!c.lat || !c.lon) return;
    const color = crimeColor(c.type);
    const m = L.circleMarker([c.lat, c.lon], { color, fillColor: color, fillOpacity: 0.8, radius: 6, weight: 1 })
      .bindPopup(`<b>${c.type}</b><br>${c.address}<br>${fmtDate(c.date)}`)
      .addTo(maps.crime);
    crimeMarkers.push(m);
  });

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

// ─── INIT & REFRESH LOOPS ───────────────────────────────────────
async function init() {
  initTabs();
  initMaps();

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
    fetchCalendars(),
  ]);

  // Refresh timers
  setInterval(fetchWeather,  CFG.refresh.weather);
  setInterval(() => { fetchAlerts(); fetchUSGS(); }, CFG.refresh.alerts);
  setInterval(fetchAircraft, CFG.refresh.aircraft);
  setInterval(fetchReddit,   CFG.refresh.community);
  setInterval(fetchServices, CFG.refresh.services);
  setInterval(fetchNews,     CFG.refresh.community);
}

document.addEventListener('DOMContentLoaded', init);
