// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const puppeteer = require('puppeteer');
const path = require('path');
const dns = require('dns').promises;

const app = express();
const PORT = process.env.PORT || 3001;

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';

console.log('🔑 GOOGLE_MAPS_API_KEY loaded:', GOOGLE_MAPS_API_KEY ? `✅ ${GOOGLE_MAPS_API_KEY.substring(0, 10)}...` : '❌ NOT SET');

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
};

const SKIP_DOMAINS = ['sentry.io', 'wixpress.com', 'example.com', 'facebook.com', 'google.com'];
const CONTACT_PATHS = ['/contact', '/about', '/about-us', '/contact-us', '/reach-us'];
const EMAIL_PREFIXES = ['info', 'contact', 'hello', 'admin', 'support', 'office', 'enquiries', 'mail', 'team'];

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi;

app.use(cors());
app.use(express.json());

// Config for Frontend
app.get('/api/config', (req, res) => {
  res.json({ GOOGLE_MAPS_API_KEY: GOOGLE_MAPS_API_KEY });
});

// Email Helpers
function extractEmail(text) {
  if (!text) return null;
  const matches = text.match(EMAIL_RE) || [];
  for (let email of matches) {
    email = email.toLowerCase();
    const domain = email.split('@')[1];
    if (domain && !SKIP_DOMAINS.some(d => domain.includes(d))) {
      return email;
    }
  }
  return null;
}

async function fetchHtml(url, timeout = 10000, extraHeaders = {}) {
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), timeout);
    const res = await fetch(url, { signal: controller.signal, headers: { ...BROWSER_HEADERS, ...extraHeaders } });
    if (!res.ok) return null;
    return await res.text();
  } catch (e) {
    return null;
  }
}

function extractSocialUrls(html) {
  const clean = u => u ? u.split('?')[0].split('#')[0] : null;
  const fb = html.match(/https?:\/\/(?:www\.)?facebook\.com\/[^"'#\s?]{6,}/i);
  const ig = html.match(/https?:\/\/(?:www\.)?instagram\.com\/([^"'#\s?/]{3,})/i);
  const tw = html.match(/https?:\/\/(?:www\.)?(?:twitter|x)\.com\/([^"'#\s?/]{3,})/i);
  return {
    facebook: clean(fb && fb[0]),
    instagram: clean(ig && ig[0]),
    twitter: clean(tw && tw[0]),
  };
}

// Keep for backward compat in usePuppeteer branch
function extractFacebookUrl(html) {
  return extractSocialUrls(html).facebook;
}

// Geocode a location string to get viewport bounds (northeast/southwest)
async function geocodeLocation(location) {
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${GOOGLE_MAPS_API_KEY}`;
    const res = await fetch(url);
    const j = await res.json();
    console.log(`[Geocode] status=${j.status}`);
    if (j.status === 'OK' && j.results && j.results[0] && j.results[0].geometry && j.results[0].geometry.viewport) {
      return j.results[0].geometry.viewport;
    }
  } catch (e) {
    console.error('[Geocode] failed:', e.message);
  }
  return null;
}

// Derive a bounding box from the coordinates of already-found places (fallback when geocoding fails)
function deriveViewport(places) {
  const lats = [], lngs = [];
  for (const p of places) {
    if (p.geometry && p.geometry.location) {
      lats.push(p.geometry.location.lat);
      lngs.push(p.geometry.location.lng);
    }
  }
  if (lats.length < 2) return null;
  const pad = 0.05; // ~5km padding so the grid extends beyond the known cluster
  return {
    northeast: { lat: Math.max(...lats) + pad, lng: Math.max(...lngs) + pad },
    southwest: { lat: Math.min(...lats) - pad, lng: Math.min(...lngs) - pad }
  };
}

// Generate a grid of lat/lng points inside viewport
function generateGrid(viewport, cols = 3, rows = 3) {
  const ne = viewport.northeast;
  const sw = viewport.southwest;
  const latStep = (ne.lat - sw.lat) / Math.max(1, rows - 1);
  const lngStep = (ne.lng - sw.lng) / Math.max(1, cols - 1);
  const pts = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lat = sw.lat + (latStep * r);
      const lng = sw.lng + (lngStep * c);
      pts.push({ lat, lng });
    }
  }
  return pts;
}

// Puppeteer
let browser = null;
async function getBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }
  return browser;
}

async function scrapeWithPuppeteer(url) {
  let page;
  try {
    const br = await getBrowser();
    page = await br.newPage();
    await page.setUserAgent(BROWSER_HEADERS['User-Agent']);
    // Use a more thorough render wait to allow client-side JS to populate content
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // 1) mailto links
    const mailtoLinks = await page.$$eval('a[href^="mailto:"]', els => els.map(e => e.getAttribute('href')));
    if (mailtoLinks && mailtoLinks.length) {
      const first = mailtoLinks[0].replace(/^mailto:/i, '').split('?')[0].trim();
      if (first) return first;
    }

    // 2) visible text (handles many obfuscations like "name [at] domain")
    const bodyText = await page.evaluate(() => document.body ? document.body.innerText || '' : '');
    let found = extractEmail(bodyText);
    if (found) return found;

    // try common obfuscation patterns in visible text
    const obf = bodyText.match(/[A-Za-z0-9._%+-]+\s*(?:@|\[at\]|\(at\)|\s+at\s+)\s*[A-Za-z0-9.-]+\.[A-Za-z]{2,}/i);
    if (obf) {
      const cleaned = obf[0].replace(/\[at\]|\(at\)|\s+at\s+/gi, '@').replace(/\s+/g, '');
      return cleaned;
    }

    // 3) data attributes like data-email, data-contact, data-mail
    const dataAttrs = await page.evaluate(() => {
      const sel = '[data-email],[data-contact],[data-mail]';
      return Array.from(document.querySelectorAll(sel)).map(e => e.dataset && (e.dataset.email || e.dataset.contact || e.dataset.mail)).filter(Boolean);
    });
    if (dataAttrs && dataAttrs.length) {
      const e = extractEmail(dataAttrs.join(' '));
      if (e) return e;
      return dataAttrs[0];
    }

    // 4) scan inline scripts for emails or concatenation patterns
    const scriptsText = await page.evaluate(() => Array.from(document.scripts || []).map(s => s.textContent || '').join('\n'));
    const scriptEmail = scriptsText.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/i);
    if (scriptEmail) return scriptEmail[0];

    // 5) last resort: raw HTML content
    const html = await page.content();
    const htmlEmail = html.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/i);
    if (htmlEmail) return htmlEmail[0];

    return null;
  } catch (e) {
    console.log(`Puppeteer failed for: ${url}`);
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

// ── Method 1: Sitemap traversal ─────────────────────────────────────────────
async function scrapeSitemap(baseUrl) {
  try {
    const xml = await fetchHtml(new URL('/sitemap.xml', baseUrl).href);
    if (!xml) return null;
    const urls = [];
    for (const m of xml.matchAll(/<loc>\s*(https?:\/\/[^<\s]+)\s*<\/loc>/gi)) {
      if (/contact|about|reach|enquir|team/i.test(m[1])) urls.push(m[1].trim());
    }
    console.log(`[Sitemap] found ${urls.length} relevant URLs`);
    for (const u of urls.slice(0, 5)) {
      const html = await fetchHtml(u);
      const email = html && extractEmail(html);
      if (email) { console.log(`[Sitemap] ✅ found email at ${u}`); return email; }
    }
  } catch { /* ignore */ }
  return null;
}

// ── Method 2: PDF extraction ─────────────────────────────────────────────────
async function scrapePdfs(html, baseUrl) {
  let pdfParse;
  try { pdfParse = require('pdf-parse'); } catch { return null; }
  const links = [];
  for (const m of html.matchAll(/href=["']([^"']*\.pdf[^"']*)/gi)) {
    try { links.push(new URL(m[1], baseUrl).href); } catch { /* skip bad URLs */ }
  }
  console.log(`[PDF] checking ${links.length} PDF link(s)`);
  for (const u of links.slice(0, 3)) {
    try {
      const res = await fetch(u, { headers: BROWSER_HEADERS });
      if (!res.ok) continue;
      const buf = await res.buffer();
      const data = await pdfParse(buf);
      const email = extractEmail(data.text);
      if (email) { console.log(`[PDF] ✅ found email in ${u}`); return email; }
    } catch { /* ignore per-pdf errors */ }
  }
  return null;
}

// ── Method 3: WHOIS / RDAP lookup ────────────────────────────────────────────
async function whoisEmail(domain) {
  try {
    const res = await fetch(`https://rdap.org/domain/${domain}`, {
      headers: { ...BROWSER_HEADERS, Accept: 'application/json' }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const email = extractEmail(JSON.stringify(data));
    if (email) console.log(`[WHOIS] ✅ found email for ${domain}`);
    return email;
  } catch { return null; }
}

// ── Method 4: Hunter.io API (optional — requires HUNTER_API_KEY in .env) ─────
async function hunterLookup(domain) {
  if (!process.env.HUNTER_API_KEY) return null;
  try {
    console.log(`[Hunter.io] → ${domain}`);
    const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${process.env.HUNTER_API_KEY}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const json = await res.json();
    const emails = (json.data && json.data.emails) || [];
    const best = emails.find(e => e.type === 'generic') || emails[0];
    if (best) { console.log(`[Hunter.io] ✅ found: ${best.value}`); return best.value; }
  } catch { /* ignore */ }
  return null;
}

// ── Method 5: Common email prefix guessing (MX-verified domain) ──────────────
async function guessEmail(domain) {
  try {
    const mx = await dns.resolveMx(domain);
    if (!mx || !mx.length) return null;
    // Return best-guess prefix — all prefixes are plausible, info@ is most common
    const candidate = `${EMAIL_PREFIXES[0]}@${domain}`;
    console.log(`[Guess] domain has MX → returning best-guess: ${candidate}`);
    return candidate;
  } catch { return null; }
}

// Scraping Functions
async function scrapeWebsite(url) {
  console.log(`[Website] → ${url}`);
  const html = await fetchHtml(url);
  if (!html) return { email: null, fbUrl: null, igUrl: null };

  const social = extractSocialUrls(html);
  const fbUrl = social.facebook;
  const igUrl = social.instagram;

  let email = extractEmail(html);
  if (email) return { email, fbUrl, igUrl };

  for (const p of CONTACT_PATHS) {
    const contactUrl = new URL(p, url).href;
    const cHtml = await fetchHtml(contactUrl);
    if (cHtml) {
      email = extractEmail(cHtml);
      if (email) return { email, fbUrl, igUrl };
    }
  }

  // Sitemap traversal — find contact/about pages not in CONTACT_PATHS
  email = await scrapeSitemap(url);
  if (email) return { email, fbUrl, igUrl };

  // PDF extraction — scan PDF files linked on the main page
  email = await scrapePdfs(html, url);
  if (email) return { email, fbUrl, igUrl };

  // WHOIS / RDAP — check domain registrant contact
  const domain = new URL(url).hostname.replace(/^www\./, '');
  email = await whoisEmail(domain);
  if (email) return { email, fbUrl, igUrl };

  // Hunter.io API — pre-indexed email database (free tier: 25/mo)
  email = await hunterLookup(domain);
  if (email) return { email, fbUrl, igUrl };

  // Puppeteer full render — JS-heavy sites
  email = await scrapeWithPuppeteer(url);
  if (email) return { email, fbUrl, igUrl };

  // Last resort — guess common prefix if domain has MX records
  email = await guessEmail(domain);
  return { email, fbUrl, igUrl };
}

async function scrapeFacebook(fbUrl) {
  if (!fbUrl) return null;
  console.log(`[Facebook] → ${fbUrl}`);

  const base = fbUrl.replace(/\/$/, '');
  const aboutUrl = base + '/about';

  // mbasic.facebook.com shows public About pages without login and without JS
  const mbasicUrl = aboutUrl.replace(/^https?:\/\/(?:www\.)?facebook\.com/, 'https://mbasic.facebook.com');
  const mbasicHtml = await fetchHtml(mbasicUrl, 15000);
  if (mbasicHtml) {
    const email = extractEmail(mbasicHtml);
    if (email) { console.log(`[Facebook] ✅ found via mbasic`); return email; }
  }

  // Puppeteer fallback with login-gate detection
  let page;
  try {
    const br = await getBrowser();
    page = await br.newPage();
    await page.setUserAgent(BROWSER_HEADERS['User-Agent']);
    await page.goto(aboutUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

    const currentUrl = page.url();
    if (currentUrl.includes('login') || currentUrl.includes('checkpoint')) {
      console.log(`[Facebook] ⚠️ login wall — giving up`);
      return null;
    }

    const text = await page.evaluate(() => document.body ? document.body.innerText || '' : '');
    const email = extractEmail(text);
    if (email) console.log(`[Facebook] ✅ found via Puppeteer`);
    return email;
  } catch (e) {
    console.log(`[Facebook] Puppeteer failed: ${e.message}`);
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

async function scrapeInstagram(igUrl) {
  if (!igUrl) return null;
  console.log(`[Instagram] → ${igUrl}`);
  try {
    // Instagram embeds profile data (including bio) in the page HTML for mobile UAs
    const html = await fetchHtml(igUrl, 15000, {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
    });
    if (html) {
      const email = extractEmail(html);
      if (email) { console.log(`[Instagram] ✅ found email in bio`); return email; }
    }
  } catch { /* ignore */ }
  return null;
}

// API
app.post('/api/scrape-email', async (req, res) => {
  const { url, name, city } = req.body;
  let email = null;
  let result = null;

  if (url) {
    result = await scrapeWebsite(url);
    email = result && result.email;
  }

  if (!email && result && result.fbUrl) {
    email = await scrapeFacebook(result.fbUrl);
  }

  if (!email && result && result.igUrl) {
    email = await scrapeInstagram(result.igUrl);
  }

  console.log(`✅ Final Email: ${email || 'Not Found'}`);
  res.json({ email: email || null });
});

app.get('/health', (req, res) => res.json({ status: "ok" }));

// Live search using Google Places Text Search + Details
app.post('/api/search-places', async (req, res) => {
  if (!GOOGLE_MAPS_API_KEY) return res.status(400).json({ error: 'GOOGLE_MAPS_API_KEY not configured' });
  const { location } = req.body || {};
  if (!location) return res.status(400).json({ error: 'location required' });

  // Support multiple comma-separated keywords or a single keyword
  const rawKw = req.body.keywords || req.body.keyword || '';
  const keywordList = (Array.isArray(rawKw) ? rawKw : String(rawKw).split(','))
    .map(s => s.trim()).filter(Boolean);
  if (!keywordList.length) return res.status(400).json({ error: 'keyword required' });

  try {
    // Single keyword gets full 500, multiple keywords cap at 200 each to keep response time reasonable
    const PER_KEYWORD_MAX = keywordList.length === 1 ? 500 : 200;
    const uniqueMap = new Map();

    // Collect pages into a given map up to a given limit
    async function collectPages(buildUrl, targetMap, limit) {
      let token = null;
      let attempt = 0;
      do {
        const pj = await fetch(buildUrl(token)).then(r => r.json());
        if (pj.error_message) { console.error('❌ Google API Error:', pj.error_message); break; }
        for (const r of (pj.results || [])) if (r && r.place_id) targetMap.set(r.place_id, r);
        token = pj.next_page_token || null;
        if (token) await new Promise(r => setTimeout(r, 1500));
        attempt++;
      } while (token && targetMap.size < limit && attempt < 3);
    }

    // Geocode location once and reuse across all keywords
    let viewport = await geocodeLocation(location);

    for (const keyword of keywordList) {
      const kwMap = new Map();
      const q = `${keyword} in ${location}`;
      console.log(`🔍 [${keyword}] starting — global so far: ${uniqueMap.size}`);

      // Phase 1: Broad Text Search
      await collectPages(
        tok => `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(q)}&key=${GOOGLE_MAPS_API_KEY}` + (tok ? `&pagetoken=${tok}` : ''),
        kwMap, PER_KEYWORD_MAX
      );
      console.log(`  Phase 1 [${keyword}]: ${kwMap.size} results`);

      // Phase 2: 4×4 grid — Text Search + Nearby (radius) + Nearby (distance-ranked)
      if (kwMap.size < PER_KEYWORD_MAX) {
        // Use geocoded viewport, or derive from current keyword's Phase 1 results, or prior keywords
        const vp = viewport
          || deriveViewport(Array.from(kwMap.values()))
          || deriveViewport(Array.from(uniqueMap.values()));
        if (!viewport && vp) viewport = vp; // cache for subsequent keywords
        console.log(`  [Grid] viewport=${vp ? 'OK' : 'FAILED — grid skipped'}`);

        if (vp) {
          const GRID = 4; // 16 points — fast enough to complete in ~30s per keyword
          const points = generateGrid(vp, GRID, GRID);
          const midLat = (vp.northeast.lat + vp.southwest.lat) / 2;
          const latMeters = (vp.northeast.lat - vp.southwest.lat) * 111000;
          const lngMeters = (vp.northeast.lng - vp.southwest.lng) * 111000 * Math.cos(midLat * Math.PI / 180);
          const radius = Math.min(50000, Math.max(500, Math.round(Math.min(latMeters, lngMeters) / GRID * 0.9)));

          console.log(`  Grid: ${GRID}×${GRID} (${points.length} pts), radius ${radius}m`);

          // Run 4 grid points concurrently instead of sequentially
          const BATCH = 4;
          for (let i = 0; i < points.length && kwMap.size < PER_KEYWORD_MAX; i += BATCH) {
            await Promise.all(points.slice(i, i + BATCH).map(async pt => {
              if (kwMap.size >= PER_KEYWORD_MAX) return;
              await collectPages(
                tok => `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(q)}&location=${pt.lat},${pt.lng}&radius=${radius}&key=${GOOGLE_MAPS_API_KEY}` + (tok ? `&pagetoken=${tok}` : ''),
                kwMap, PER_KEYWORD_MAX
              );
              if (kwMap.size < PER_KEYWORD_MAX) {
                await collectPages(
                  tok => `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${pt.lat},${pt.lng}&radius=${radius}&keyword=${encodeURIComponent(keyword)}&key=${GOOGLE_MAPS_API_KEY}` + (tok ? `&pagetoken=${tok}` : ''),
                  kwMap, PER_KEYWORD_MAX
                );
              }
              if (kwMap.size < PER_KEYWORD_MAX) {
                await collectPages(
                  tok => `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${pt.lat},${pt.lng}&rankby=distance&keyword=${encodeURIComponent(keyword)}&key=${GOOGLE_MAPS_API_KEY}` + (tok ? `&pagetoken=${tok}` : ''),
                  kwMap, PER_KEYWORD_MAX
                );
              }
            }));
          }
        }
      }

      for (const [id, place] of kwMap) uniqueMap.set(id, place);
      console.log(`  Done [${keyword}]: ${kwMap.size} results → global ${uniqueMap.size}`);
    }

    console.log(`✅ Final unique results: ${uniqueMap.size}`);

    const places = Array.from(uniqueMap.values());

    // Enrich with place details (phone, website) for top results (limit to 10 to avoid many API calls)
    const detailed = await Promise.all(places.map(async p => {
      const out = {
        place_id: p.place_id,
        name: p.name,
        types: p.types || [],
        category: (p.types && p.types[0]) || 'Place',
        rating: p.rating,
        user_ratings_total: p.user_ratings_total,
        formatted_address: p.formatted_address,
        formatted_phone_number: null,
        website: null,
        opening_hours: p.opening_hours || null,
        business_status: p.business_status || null,
        city: location.toLowerCase()
      };

      try {
        if (p.place_id) {
          const fields = 'formatted_phone_number,website,opening_hours,business_status';
          const detUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${p.place_id}&fields=${fields}&key=${GOOGLE_MAPS_API_KEY}`;
          const dres = await fetch(detUrl);
          const dj = await dres.json();
          if (dj && dj.result) {
            out.formatted_phone_number = dj.result.formatted_phone_number || out.formatted_phone_number;
            out.website = dj.result.website || out.website;
            out.opening_hours = dj.result.opening_hours || out.opening_hours;
            out.business_status = dj.result.business_status || out.business_status;
          }
        }
      } catch (e) {
        // ignore details errors per-place
      }

      return out;
    }));

    return res.json({ results: detailed });
  } catch (e) {
    console.error('Google Places search failed', e);
    return res.status(500).json({ error: 'search failed' });
  }
});

// Serve Frontend
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(GOOGLE_MAPS_API_KEY ? `✅ Google API Key Loaded` : `⚠️ Mock Mode Only`);
});

// Enrich places with email by visiting website and falling back to Facebook
app.post('/api/enrich-places', async (req, res) => {
  const places = Array.isArray(req.body) ? req.body : (req.body && req.body.places) || [];
  const usePuppeteer = !!(req.body && req.body.usePuppeteer);
  if (!places.length) return res.status(400).json({ error: 'places required' });

  const results = [];
  for (const p of places) {
    const out = Object.assign({}, p);
    out.email = out.email || null;
    out.fbUrl = out.fbUrl || null;

    try {
      // Prefer website if available
      if (out.website) {
        let r = null;
        if (usePuppeteer) {
          const emailFromRender = await scrapeWithPuppeteer(out.website);
          const pageHtml = await fetchHtml(out.website) || '';
          const social = extractSocialUrls(pageHtml);
          r = { email: emailFromRender, fbUrl: social.facebook, igUrl: social.instagram };
        } else {
          r = await scrapeWebsite(out.website);
        }

        if (r && r.email) out.email = r.email;
        if (r && r.fbUrl) out.fbUrl = r.fbUrl;
        if (r && r.igUrl) out.igUrl = r.igUrl;

        // Social media fallback chain: Facebook → Instagram
        if (!out.email && out.fbUrl) {
          out.email = await scrapeFacebook(out.fbUrl);
        }
        if (!out.email && out.igUrl) {
          out.email = await scrapeInstagram(out.igUrl);
        }
      }
    } catch (e) {
      // ignore per-place errors
    }

    results.push(out);
  }

  return res.json({ results });
});