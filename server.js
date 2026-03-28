/**
 * 10523 HQ Dashboard — Zero-dependency Node.js server
 * Requires only Node.js built-ins: http, https, url, path, fs
 * Run with: node server.js
 */

const http  = require('http');
const https = require('https');
const url   = require('url');
const path  = require('path');
const fs    = require('fs');

const PORT    = 3000;
const PUBLIC  = path.join(__dirname, 'public');

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
        'User-Agent': 'Mozilla/5.0 (compatible; HomeDashboard/1.0)',
        'Accept': 'application/json, text/html, application/xml, */*',
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
  try {
    const r = await fetch(`https://spotcrime.com/crimes.json?lat=41.0534&lon=-73.8196&radius=0.02&callback=spotcrime`, {
      headers: { 'Referer': 'https://spotcrime.com/' }
    });
    let text = r.text().trim();
    if (text.startsWith('spotcrime(')) text = text.slice(10);
    if (text.endsWith(');')) text = text.slice(0, -2);
    else if (text.endsWith(')')) text = text.slice(0, -1);
    json(res, JSON.parse(text));
  } catch(e) {
    json(res, { crimes: [], error: e.message });
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
};

// ─── SERVER ──────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  req.pathname = parsed.pathname;
  req.query    = parsed.query;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' });
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
  console.log(`\n    Weather, aircraft, alerts, services all loading...`);
  console.log(`    Press Ctrl+C to stop.\n`);
});
