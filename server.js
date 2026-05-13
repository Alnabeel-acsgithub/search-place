// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const puppeteer = require('puppeteer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';

console.log('🔑 GOOGLE_MAPS_API_KEY loaded:', GOOGLE_MAPS_API_KEY ? `✅ ${GOOGLE_MAPS_API_KEY.substring(0, 10)}...` : '❌ NOT SET');

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
};

const SKIP_DOMAINS = ['sentry.io', 'wixpress.com', 'example.com', 'facebook.com', 'google.com'];
const CONTACT_PATHS = ['/contact', '/about', '/about-us', '/contact-us', '/reach-us'];

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

async function fetchHtml(url, timeout = 10000) {
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), timeout);
    const res = await fetch(url, { signal: controller.signal, headers: BROWSER_HEADERS });
    if (!res.ok) return null;
    return await res.text();
  } catch (e) {
    return null;
  }
}

function extractFacebookUrl(html) {
  const match = html.match(/https?:\/\/(?:www\.)?facebook\.com\/[^"'#\s?]{6,}/i);
  return match ? match[0].split('?')[0].split('#')[0] : null;
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
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    
    const mailto = await page.evaluate(() => {
      const a = document.querySelector('a[href^="mailto:"]');
      return a ? a.href.replace('mailto:', '').trim() : null;
    });
    if (mailto) return mailto;

    const bodyText = await page.evaluate(() => document.body.innerText);
    return extractEmail(bodyText);
  } catch (e) {
    console.log(`Puppeteer failed for: ${url}`);
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

// Scraping Functions
async function scrapeWebsite(url) {
  console.log(`[Website] → ${url}`);
  const html = await fetchHtml(url);
  if (!html) return { email: null, fbUrl: null };

  const fbUrl = extractFacebookUrl(html);
  let email = extractEmail(html);
  if (email) return { email, fbUrl };

  for (const p of CONTACT_PATHS) {
    const contactUrl = new URL(p, url).href;
    const cHtml = await fetchHtml(contactUrl);
    if (cHtml) {
      email = extractEmail(cHtml);
      if (email) return { email, fbUrl };
    }
  }

  email = await scrapeWithPuppeteer(url);
  return { email, fbUrl };
}

async function scrapeFacebook(fbUrl) {
  if (!fbUrl) return null;
  console.log(`[Facebook] → ${fbUrl}`);

  const aboutUrl = fbUrl.endsWith('/about') ? fbUrl : fbUrl + '/about';
  const html = await fetchHtml(aboutUrl) || await fetchHtml(fbUrl);

  if (html) {
    let email = extractEmail(html);
    if (email) return email;
  }
  return await scrapeWithPuppeteer(aboutUrl);
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

  console.log(`✅ Final Email: ${email || 'Not Found'}`);
  res.json({ email: email || null });
});

app.get('/health', (req, res) => res.json({ status: "ok" }));

// Live search using Google Places Text Search + Details
app.post('/api/search-places', async (req, res) => {
  if (!GOOGLE_MAPS_API_KEY) return res.status(400).json({ error: 'GOOGLE_MAPS_API_KEY not configured' });
  const { keyword, location } = req.body || {};
  if (!keyword || !location) return res.status(400).json({ error: 'keyword and location required' });

  try {
    const q = `${keyword} in ${location}`;
    const tsUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(q)}&key=${GOOGLE_MAPS_API_KEY}`;
    console.log(`🔍 Searching Google Places: "${q}"`);
    
    const tsRes = await fetch(tsUrl);
    const tsJson = await tsRes.json();
    
    if (tsJson.error_message) {
      console.error('❌ Google API Error:', tsJson.error_message);
      return res.status(400).json({ error: `Google API: ${tsJson.error_message}` });
    }
    
    console.log(`✅ Found ${tsJson.results ? tsJson.results.length : 0} places from Google`);
    const places = (tsJson.results || []).slice(0, 15);

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
        // If usePuppeteer flag is set, directly render with Puppeteer for better detection
        let r = null;
        if (usePuppeteer) {
          const emailFromRender = await scrapeWithPuppeteer(out.website);
          r = { email: emailFromRender, fbUrl: extractFacebookUrl(await fetchHtml(out.website) || '') };
        } else {
          r = await scrapeWebsite(out.website);
        }

        if (r && r.email) out.email = r.email;
        if (r && r.fbUrl) out.fbUrl = r.fbUrl;

        // If we have a fbUrl but no email, try scraping FB page
        if (!out.email && out.fbUrl) {
          const f = await scrapeFacebook(out.fbUrl);
          if (f) out.email = f;
        }
      }
    } catch (e) {
      // ignore per-place errors
    }

    results.push(out);
  }

  return res.json({ results });
});