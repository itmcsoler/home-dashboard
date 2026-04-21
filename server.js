/**
 * 10523 HQ Dashboard — Zero-dependency Node.js server
 * Requires only Node.js built-ins: http, https, url, path, fs
 * Run with: node server.js
 */

const http   = require('http');
const https  = require('https');
const url    = require('url');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const PORT    = 3000;
const PUBLIC  = path.join(__dirname, 'public');
const CONFIG_FILE = path.join(__dirname, 'config.json');

// ─── CONFIG (persists AIS key across restarts) ────────────────────
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch(e) { return {}; }
}
function saveConfig(data) {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2)); } catch(e) { console.warn('Config save failed:', e.message); }
}

// ─── MIME TYPES ──────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

// ─── HTTP/HTTPS FETCH (built-in) ─────────────────────────────────
function fetch(urlStr, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const mod = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: opts.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        ...(opts.headers || {})
      },
      timeout: opts.timeout || 10000
    };
    const req = mod.request(options, res => {
      // Follow redirects
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        return fetch(res.headers.location, opts).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ ok: res.statusCode < 400, status: res.statusCode, text: () => data, json: () => JSON.parse(data) }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// ─── SIMPLE RSS PARSER (no cheerio needed) ──────────────────────
function parseRSS(xml) {
  const items = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
  blocks.forEach(block => {
    const get = tag => {
      const cdataRe = new RegExp('<' + tag + '[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/' + tag + '>', 'i');
      const plainRe = new RegExp('<' + tag + '[^>]*>([^<]*)<\\/' + tag + '>', 'i');
      const m = block.match(cdataRe) || block.match(plainRe);
      return m ? m[1].trim() : '';
    };
    const link = get('link') || (block.match(/<link[^>]+href="([^"]+)"/) || [])[1] || '';
    items.push({
      title:   get('title'),
      link,
      date:    get('pubDate') || get('published') || get('updated'),
      summary: get('description') || get('summary') || get('content')
    });
  });
  const feedTitle = (xml.match(/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i) || xml.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
  return { title: feedTitle, items: items.slice(0, 15) };
}

// ─── JSON RESPONSE HELPER ────────────────────────────────────────
function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

// ─── STATIC FILE HANDLER ─────────────────────────────────────────
function serveStatic(req, res) {
  let filePath = path.join(PUBLIC, req.pathname === '/' ? 'index.html' : req.pathname);
  const ext = path.extname(filePath);
  if (!ext) filePath += '.html';
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'text/plain' });
    res.end(data);
  });
}

// ─── ROUTE HANDLERS ──────────────────────────────────────────────

async function handleRSS(req, res) {
  const feedUrl = req.query.url;
  if (!feedUrl) return json(res, { error: 'url param required', items: [] }, 400);
  try {
    const r = await fetch(feedUrl);
    const text = r.text();
    const feed = parseRSS(text);
    json(res, feed);
  } catch(e) {
    json(res, { error: e.message, items: [] });
  }
}

async function handleCalendar(req, res, village) {
  const urls = {
    elmsford:  'https://www.elmsford.gov/calendar.aspx',
    tarrytown: 'https://www.tarrytownny.gov/calendar/month'
  };
  const sourceNames = { elmsford: 'Elmsford Village', tarrytown: 'Tarrytown' };
  try {
    const r = await fetch(urls[village]);
    const html = r.text();
    // Extract event titles from common CivicPlus/Drupal calendar patterns
    const events = [];
    const patterns = [
      /class="[^"]*cal_titlelinks[^"]*"[^>]*><a[^>]+href="([^"]*)"[^>]*>([^<]+)</gi,
      /class="[^"]*views-field-title[^"]*"[\s\S]*?<a[^>]+href="([^"]*)"[^>]*>([^<]+)</gi,
      /class="[^"]*fc-event-title[^"]*">([^<]+)</gi,
      /<a[^>]+class="[^"]*event[^"]*"[^>]+href="([^"]*)"[^>]*>([^<]+)</gi,
    ];
    patterns.forEach(re => {
      let m;
      while ((m = re.exec(html)) !== null && events.length < 12) {
        const title = (m[2] || m[1] || '').trim().replace(/&amp;/g,'&').replace(/&#039;/g,"'");
        const href  = m[1] || '';
        if (title && title.length > 2 && !events.find(e => e.title === title)) {
          const link = href.startsWith('http') ? href : `https://www.${village === 'elmsford' ? 'elmsford.gov' : 'tarrytownny.gov'}${href}`;
          events.push({ title, link, source: sourceNames[village] });
        }
      }
    });
    json(res, { events: events.slice(0, 10), source: sourceNames[village] });
  } catch(e) {
    json(res, { events: [], error: e.message, source: sourceNames[village] });
  }
}

async function handleConed(req, res) {
  try {
    const r = await fetch('https://outagemap.coned.com/external/api/outageMap/fullData', {
      headers: { 'Referer': 'https://outagemap.coned.com/' }
    });
    const d = r.json();
    let totalOutages = 0, customersAffected = 0;
    if (d && d.summaryData) {
      const counties = d.summaryData.counties || d.summaryData || [];
      const wc = Array.isArray(counties) && counties.find(c => c.name && /westchester/i.test(c.name));
      if (wc) { totalOutages = wc.outages || 0; customersAffected = wc.customersAffected || 0; }
      else { totalOutages = d.summaryData.totalOutages || 0; }
    }
    json(res, {
      name: 'ConEdison', status: totalOutages === 0 ? 'operational' : customersAffected > 100 ? 'outage' : 'degraded',
      incidents: totalOutages, customersAffected,
      detail: totalOutages === 0 ? 'No outages in Westchester' : `${totalOutages} outage(s) · ${customersAffected} customers affected`,
      link: 'https://outagemap.coned.com/'
    });
  } catch(e) {
    json(res, { name: 'ConEdison', status: 'unknown', detail: 'Could not reach ConEd outage map', incidents: 0, link: 'https://outagemap.coned.com/' });
  }
}

async function handleServiceScrape(req, res, name, checkUrl, displayName, icon) {
  try {
    const r = await fetch(checkUrl);
    const text = r.text();
    const hasIssue = /outage|issue|problem|degraded|service\s+alert|disruption/i.test(text);
    const hasAdvisory = /advisory|warning|boil\s+water/i.test(text);
    json(res, {
      name: displayName, icon,
      status: (hasIssue || hasAdvisory) ? 'degraded' : 'operational',
      detail: hasIssue ? 'Possible service issue reported — click to check' : hasAdvisory ? 'Advisory in effect — click to check' : 'No issues detected',
      link: checkUrl
    });
  } catch(e) {
    json(res, { name: displayName, icon, status: 'unknown', detail: 'Status check unavailable', link: checkUrl });
  }
}

async function handleAllServices(req, res) {
  const services = await Promise.allSettled([
    // ConEd — has a real JSON API
    (async () => {
      try {
        const r = await fetch('https://outagemap.coned.com/external/api/outageMap/fullData', { headers: { 'Referer': 'https://outagemap.coned.com/' } });
        const d = r.json();
        let outages = 0, cust = 0;
        if (d?.summaryData) {
          const arr = d.summaryData.counties || [];
          const wc = arr.find && arr.find(c => /westchester/i.test(c.name || ''));
          outages = wc ? (wc.outages || 0) : (d.summaryData.totalOutages || 0);
          cust = wc ? (wc.customersAffected || 0) : 0;
        }
        return { name:'ConEdison', icon:'⚡', status: outages===0?'operational':cust>100?'outage':'degraded', incidents:outages, customersAffected:cust, detail: outages===0?'No outages in Westchester':`${outages} outage(s) · ${cust} customers affected`, link:'https://outagemap.coned.com/' };
      } catch(e) { return { name:'ConEdison', icon:'⚡', status:'unknown', detail:'Status unavailable', incidents:0, link:'https://outagemap.coned.com/' }; }
    })(),
    // Comcast
    (async () => {
      try {
        const r = await fetch('https://www.xfinity.com/support/status');
        const t = r.text();
        const issue = /outage|issue|problem|degraded/i.test(t);
        return { name:'Comcast / Xfinity', icon:'📡', status: issue?'degraded':'operational', detail: issue?'Possible service issue':'No issues detected', link:'https://www.xfinity.com/support/status' };
      } catch(e) { return { name:'Comcast / Xfinity', icon:'📡', status:'unknown', detail:'Status unavailable', link:'https://www.xfinity.com/support/status' }; }
    })(),
    // Verizon
    (async () => {
      try {
        const r = await fetch('https://www.verizon.com/support/network-status/');
        const t = r.text();
        const issue = /outage|issue|problem|degraded/i.test(t);
        return { name:'Verizon Wireless', icon:'📱', status: issue?'degraded':'operational', detail: issue?'Possible service issue':'No issues detected', link:'https://www.verizon.com/support/network-status/' };
      } catch(e) { return { name:'Verizon Wireless', icon:'📱', status:'unknown', detail:'Status unavailable', link:'https://www.verizon.com/support/network-status/' }; }
    })(),
    // National Grid
    (async () => {
      try {
        const r = await fetch('https://www.nationalgridus.com/our-services/managing-an-outage/outage-central');
        const t = r.text();
        const issue = /outage|problem/i.test(t);
        return { name:'National Grid', icon:'🔥', status: issue?'degraded':'operational', detail: issue?'Possible outage reported':'No issues detected', link:'https://www.nationalgridus.com/our-services/managing-an-outage/outage-central' };
      } catch(e) { return { name:'National Grid', icon:'🔥', status:'unknown', detail:'Status unavailable', link:'https://www.nationalgridus.com/our-services/managing-an-outage/outage-central' }; }
    })(),
    // SUEZ Water
    (async () => {
      try {
        const r = await fetch('https://www.mysuezwater.com/outage-status');
        const t = r.text();
        const issue = /boil|outage|advisory|alert/i.test(t);
        return { name:'SUEZ Water', icon:'💧', status: issue?'degraded':'operational', detail: issue?'Advisory or outage reported':'No advisories', link:'https://www.mysuezwater.com/outage-status' };
      } catch(e) { return { name:'SUEZ Water', icon:'💧', status:'unknown', detail:'Status unavailable', link:'https://www.mysuezwater.com/outage-status' }; }
    })(),
  ]);
  json(res, services.map(r => r.status === 'fulfilled' ? r.value : { name:'Unknown', status:'unknown', detail:'Error', icon:'🔌', link:'#' }));
}

async function handleCrimes(req, res) {
  // radius=0.5 means ~0.5 degrees (~35mi) — SpotCrime "radius" is in degrees, not miles
  // Try plain JSON first (no JSONP wrapper), fall back to JSONP
  const base = 'https://spotcrime.com/crimes.json?lat=41.0534&lon=-73.8196&radius=0.05';
  const hdrs = {
    'Referer': 'https://spotcrime.com/ny/westchester/elmsford',
    'Accept': 'application/json, application/javascript, text/javascript, */*; q=0.01',
    'Accept-Language': 'en-US,en;q=0.9',
    'X-Requested-With': 'XMLHttpRequest',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin'
  };

  // Try plain JSON first
  try {
    const r = await fetch(base, { headers: hdrs, timeout: 10000 });
    if (r.ok) {
      const text = r.text().trim();
      if (text.startsWith('{') || text.startsWith('[')) {
        return json(res, JSON.parse(text));
      }
      // Might be JSONP even without callback param — strip wrapper
      const m = text.match(/^[a-zA-Z_$][\w$]*\s*\(([\s\S]+)\)\s*;?\s*$/);
      if (m) return json(res, JSON.parse(m[1].trim()));
    }
  } catch(e) { /* fall through to JSONP attempt */ }

  // JSONP fallback
  try {
    const r2 = await fetch(base + '&callback=sc', { headers: hdrs, timeout: 10000 });
    let text = r2.text().trim();
    const m = text.match(/^[a-zA-Z_$][\w$]*\s*\(([\s\S]+)\)\s*;?\s*$/);
    if (m) text = m[1].trim();
    return json(res, JSON.parse(text));
  } catch(e) {
    return json(res, { crimes: [], error: e.message });
  }
}

// ─── MTA METRO-NORTH STATUS ──────────────────────────────────────
async function handleTransit(req, res) {
  // MTA public service status XML feed — no API key required
  const feedUrl = 'http://web.mta.info/status/serviceStatus.txt';
  try {
    const r = await fetch(feedUrl, { timeout: 8000 });
    const xml = r.text();

    function parseSection(sectionName) {
      const sec = xml.match(new RegExp(`<${sectionName}>([\\s\\S]*?)<\\/${sectionName}>`));
      if (!sec) return [];
      const lines = [];
      const lineRe = /<line>([\s\S]*?)<\/line>/g;
      let m;
      while ((m = lineRe.exec(sec[1])) !== null) {
        const get = tag => {
          const t = m[1].match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
          return t ? t[1].replace(/<[^>]+>/g,'').trim() : '';
        };
        const name = get('name');
        if (name) lines.push({ name, status: get('status'), text: get('text'), date: get('Date'), time: get('Time') });
      }
      return lines;
    }

    json(res, {
      metro_north: parseSection('metro_north'),
      lirr:        parseSection('lirr'),
      subway:      parseSection('subway'),
    });
  } catch(e) {
    json(res, { metro_north: [], error: e.message });
  }
}

// ─── MINIMAL WEBSOCKET CLIENT (pure Node.js, no npm) ─────────────
// Routes the AIS connection server-side so browser SSL inspection can't block it.
function wsClient(opts) {
  const wsKey = crypto.randomBytes(16).toString('base64');
  let buf = Buffer.alloc(0);

  function buildFrame(opcode, payload) {
    const mask = crypto.randomBytes(4);
    const len  = payload.length;
    let hdr;
    if      (len <= 125)    { hdr = Buffer.alloc(6);  hdr[0]=0x80|opcode; hdr[1]=0x80|len;  mask.copy(hdr,2); }
    else if (len <= 65535)  { hdr = Buffer.alloc(8);  hdr[0]=0x80|opcode; hdr[1]=0x80|126; hdr.writeUInt16BE(len,2); mask.copy(hdr,4); }
    else                    { hdr = Buffer.alloc(14); hdr[0]=0x80|opcode; hdr[1]=0x80|127; hdr.writeBigUInt64BE(BigInt(len),2); mask.copy(hdr,10); }
    const body = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) body[i] = payload[i] ^ mask[i % 4];
    return Buffer.concat([hdr, body]);
  }

  function parseFrames(socket) {
    while (buf.length >= 2) {
      const opcode  = buf[0] & 0x0f;
      const hasMask = (buf[1] & 0x80) !== 0;
      let plen = buf[1] & 0x7f, off = 2;
      if      (plen === 126) { if (buf.length < 4)  return; plen = buf.readUInt16BE(2);          off = 4; }
      else if (plen === 127) { if (buf.length < 10) return; plen = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (hasMask) off += 4;
      if (buf.length < off + plen) return;
      let payload = buf.slice(off, off + plen);
      if (hasMask) {
        const mk = buf.slice(off - 4, off);
        payload = Buffer.from(payload);
        for (let i = 0; i < plen; i++) payload[i] ^= mk[i % 4];
      }
      buf = buf.slice(off + plen);
      if      (opcode === 1 || opcode === 2) { opts.onMessage && opts.onMessage(payload.toString()); }
      else if (opcode === 8) { socket.destroy(); opts.onClose && opts.onClose(plen >= 2 ? payload.readUInt16BE(0) : 1000, plen > 2 ? payload.slice(2).toString() : ''); return; }
      else if (opcode === 9) { socket.write(buildFrame(10, Buffer.alloc(0))); } // pong
    }
  }

  const req = https.request({
    hostname: opts.hostname, port: opts.port || 443, path: opts.path, method: 'GET',
    headers: {
      'Host': opts.hostname, 'Upgrade': 'websocket', 'Connection': 'Upgrade',
      'Sec-WebSocket-Key': wsKey, 'Sec-WebSocket-Version': '13',
      'User-Agent': 'HomeDashboard/1.0'
    }
  });
  req.on('upgrade', (res, socket, head) => {
    buf = head || Buffer.alloc(0);
    const send = text => socket.write(buildFrame(1, Buffer.from(text, 'utf8')));
    socket.on('data', d => { buf = Buffer.concat([buf, d]); parseFrames(socket); });
    socket.on('close', () => opts.onClose && opts.onClose(1006, 'socket closed'));
    socket.on('error', e => opts.onError && opts.onError(e));
    opts.onOpen && opts.onOpen(send);
  });
  req.on('response', r => opts.onError && opts.onError(new Error(`HTTP ${r.statusCode} — WebSocket upgrade rejected`)));
  req.on('error', e => opts.onError && opts.onError(e));
  req.setTimeout(15000, () => { req.destroy(); opts.onError && opts.onError(new Error('Connection timeout')); });
  req.end();
}

// ─── AIS SERVER PROXY ────────────────────────────────────────────
// Maintains a single persistent AIS WebSocket on the server side.
// Browser polls GET /api/ais to get the latest vessel snapshot.
let aisKey       = '';
let aisVessels   = {};   // MMSI → vessel
let aisConnected = false;
let aisRetryTimer = null;
let aisStatus    = 'off'; // 'off' | 'connecting' | 'live'

function startAISProxy(key) {
  if (!key) return;
  if (aisRetryTimer) { clearTimeout(aisRetryTimer); aisRetryTimer = null; }
  aisKey = key;
  aisStatus = 'connecting';
  console.log('[AIS proxy] Connecting to aisstream.io…');

  wsClient({
    hostname: 'stream.aisstream.io',
    path: '/v0/stream',
    onOpen(send) {
      aisConnected = true;
      aisStatus = 'live';
      const sub = { APIKey: key, BoundingBoxes: [[[40.55, -74.10], [41.55, -73.85]]] };
      send(JSON.stringify(sub));
      console.log('[AIS proxy] Connected & subscribed · Hudson River bounds');
    },
    onMessage(text) {
      try {
        const msg = JSON.parse(text);
        if (msg.error || msg.Error) {
          console.error('[AIS proxy] Server error:', msg.error || msg.Error);
          aisStatus = 'error:' + (msg.error || msg.Error);
          return;
        }
        processAISProxy(msg);
      } catch(e) { /* ignore parse errors */ }
    },
    onClose(code, reason) {
      aisConnected = false;
      aisStatus = `closed:${code}`;
      console.log(`[AIS proxy] Closed (${code}${reason ? ' · ' + reason : ''}) — retrying in 30s`);
      if (aisKey) aisRetryTimer = setTimeout(() => startAISProxy(aisKey), 30000);
    },
    onError(e) {
      aisConnected = false;
      aisStatus = `error:${e.message}`;
      console.error('[AIS proxy] Error:', e.message, '— retrying in 30s');
      if (aisKey) aisRetryTimer = setTimeout(() => startAISProxy(aisKey), 30000);
    }
  });
}

function processAISProxy(msg) {
  const meta = msg.MetaData || {};
  const mmsi = String(meta.MMSI || meta.UserID || '');
  if (!mmsi) return;

  if (msg.MessageType === 'PositionReport' || msg.MessageType === 'StandardClassBPositionReport') {
    const pr  = msg.Message?.PositionReport || msg.Message?.StandardClassBPositionReport || {};
    const lat = meta.latitude  || pr.Latitude;
    const lon = meta.longitude || pr.Longitude;
    if (!lat || !lon || lat === 0 || lon === 0) return;
    aisVessels[mmsi] = {
      ...aisVessels[mmsi], mmsi, lat, lon,
      name:      (meta.ShipName || '').trim() || aisVessels[mmsi]?.name || `MMSI ${mmsi}`,
      sog:       pr.Sog, cog: pr.Cog, heading: pr.TrueHeading,
      navStatus: pr.NavigationalStatus,
      lastSeen:  Date.now()
    };
  } else if (msg.MessageType === 'ShipStaticData') {
    const sd = msg.Message?.ShipStaticData || {};
    aisVessels[mmsi] = {
      ...aisVessels[mmsi], mmsi,
      name:        (sd.Name || meta.ShipName || '').trim() || aisVessels[mmsi]?.name || `MMSI ${mmsi}`,
      typeCode:    sd.Type,
      destination: (sd.Destination || '').trim(),
      lastSeen:    aisVessels[mmsi]?.lastSeen || Date.now()
    };
  }
}

// Purge vessels not seen in 15 minutes
setInterval(() => {
  const cutoff = Date.now() - 15 * 60 * 1000;
  Object.keys(aisVessels).forEach(m => { if ((aisVessels[m].lastSeen || 0) < cutoff) delete aisVessels[m]; });
}, 60000);

// ─── REDDIT PROXY ────────────────────────────────────────────────
async function handleReddit(req, res) {
  const sub = (req.query.sub || 'Westchester').replace(/[^a-zA-Z0-9_]/g, '');
  try {
    const r = await fetch(`https://www.reddit.com/r/${sub}.json?limit=20`, {
      headers: { 'User-Agent': 'HomeDashboard/1.0 (local)' }
    });
    if (!r.ok) return json(res, { posts: [], error: `HTTP ${r.status}` });
    const d = r.json();
    const posts = (d.data?.children || []).map(c => c.data).map(p => ({
      title:    p.title,
      url:      p.url,
      permalink: p.permalink,
      score:    p.score,
      comments: p.num_comments,
      created:  p.created_utc,
      author:   p.author,
      flair:    p.link_flair_text || ''
    }));
    json(res, { posts });
  } catch(e) {
    json(res, { posts: [], error: e.message });
  }
}

// ─── AIRCRAFT PROXY ──────────────────────────────────────────────
async function handleAircraft(req, res) {
  const b = '40.55,-74.40,41.55,-72.90'; // lamin,lomin,lamax,lomax
  const [lamin, lomin, lamax, lomax] = b.split(',');
  try {
    const r = await fetch(
      `https://opensky-network.org/api/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`
    );
    if (r.status === 429 || r.status === 503) return json(res, { states: [], error: `rate_limited` }, 429);
    if (r.status === 401 || r.status === 403) return json(res, { states: [], error: `access_denied_${r.status}` });
    if (!r.ok) return json(res, { states: [], error: `http_${r.status}` });
    json(res, r.json());
  } catch(e) {
    json(res, { states: [], error: e.message });
  }
}

async function handleAIS(req, res) {
  json(res, {
    vessels:   Object.values(aisVessels),
    connected: aisConnected,
    status:    aisStatus,
    count:     Object.keys(aisVessels).length
  });
}

async function handleAISKey(req, res) {
  if (req.method === 'GET') {
    return json(res, { connected: aisConnected, status: aisStatus, count: Object.keys(aisVessels).length });
  }
  if (req.method !== 'POST') return json(res, { error: 'POST required' }, 405);
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    try {
      const { key } = JSON.parse(body);
      if (!key) return json(res, { error: 'key required' }, 400);
      saveConfig({ ...loadConfig(), aisKey: key });
      startAISProxy(key);
      json(res, { ok: true, message: 'AIS proxy connecting…' });
    } catch(e) { json(res, { error: e.message }, 400); }
  });
}

// ─── WAZE TRAFFIC PROXY ──────────────────────────────────────────
async function handleTraffic(req, res) {
  // Waze public live-map API — alerts & jams in a ~15-mile box around Elmsford
  const wazeUrl = 'https://www.waze.com/live-map/api/georss' +
    '?top=41.15&bottom=40.90&left=-74.10&right=-73.55&env=row&types=alerts,jams';
  try {
    const r = await fetch(wazeUrl, {
      headers: {
        'Referer': 'https://www.waze.com/live-map',
        'Accept': 'application/json, text/javascript, */*',
        'Origin': 'https://www.waze.com'
      },
      timeout: 8000
    });
    const text = r.text();
    // Waze returns JSON; occasionally wraps in a callback — strip if needed
    const clean = text.trim().replace(/^[a-zA-Z_$][\w$]*\s*\(/, '').replace(/\)\s*;?\s*$/, '');
    json(res, JSON.parse(clean));
  } catch(e) {
    json(res, { alerts: [], jams: [], error: e.message });
  }
}

// ─── ROUTER ──────────────────────────────────────────────────────
const ROUTES = {
  '/api/rss':                    handleRSS,
  '/api/calendar/elmsford':      (q, r) => handleCalendar(q, r, 'elmsford'),
  '/api/calendar/tarrytown':     (q, r) => handleCalendar(q, r, 'tarrytown'),
  '/api/service/coned':          handleConed,
  '/api/services/all':           handleAllServices,
  '/api/crimes':                 handleCrimes,
  '/api/traffic':                handleTraffic,
  '/api/transit':                handleTransit,
  '/api/ping':                   (req, res) => json(res, { ok: true }),
  '/api/reddit':                 handleReddit,
  '/api/aircraft':               handleAircraft,
  '/api/ais':                    handleAIS,
  '/api/ais/key':                handleAISKey,
};

// ─── SERVER ──────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  req.pathname = parsed.pathname;
  req.query    = parsed.query;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  const handler = ROUTES[req.pathname];
  if (handler) {
    try { await handler(req, res); }
    catch(e) { json(res, { error: e.message }, 500); }
  } else {
    serveStatic(req, res);
  }
});

server.listen(PORT, () => {
  console.log(`\n🏠  10523 HQ Dashboard`);
  console.log(`    http://localhost:${PORT}`);
  console.log(`\n    Weather, aircraft, alerts, services loading...`);

  // Auto-start AIS proxy if we have a saved key
  const cfg = loadConfig();
  if (cfg.aisKey) {
    console.log(`    AIS key found in config — connecting proxy automatically`);
    startAISProxy(cfg.aisKey);
  } else {
    console.log(`    AIS proxy ready — paste key in Marine tab to activate`);
  }
  console.log(`    Press Ctrl+C to stop.\n`);
});
