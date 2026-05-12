const express    = require('express');
const cors       = require('cors');
const fetch      = require('node-fetch');
const puppeteer  = require('puppeteer');
const path       = require('path');

const app  = express();
const PORT = process.env.PORT || 3001;
const TIMEOUT = 10000;

const BROWSER_HEADERS = {
  'User-Agent'     : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept'         : 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control'  : 'no-cache',
  'Sec-Fetch-Dest' : 'document',
  'Sec-Fetch-Mode' : 'navigate',
  'Sec-Fetch-Site' : 'none',
};

const SKIP_DOMAINS  = ['sentry.io','wixpress.com','example.com','yourwebsite.com',
  'domain.com','schema.org','cloudflare.com','google.com','facebook.com',
  'instagram.com','twitter.com','apple.com','w3.org','jquery.com'];
const SKIP_PREFIXES = ['noreply','no-reply','donotreply','mailer-daemon',
  'postmaster','webmaster','bounce','support@facebook','privacy@','legal@'];

const CONTACT_PATHS = ['/contact', '/about', '/about-us', '/contact-us', '/reach-us'];

const EMAIL_RE      = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const OBFUSCATED_RE = /([a-zA-Z0-9._%+\-]+)\s*[\[\(]?\s*(?:at|AT)\s*[\]\)]?\s*([a-zA-Z0-9.\-]+)\s*[\[\(]?\s*(?:dot|DOT)\s*[\]\)]?\s*([a-zA-Z]{2,})/g;

app.use(cors());
app.use(express.json());

// ── helpers ───────────────────────────────────────────────────────────────────

function isFacebook(url) {
  try { return new URL(url).hostname.includes('facebook.com'); } catch { return false; }
}

function extractEmail(text) {
  const candidates = [...text.matchAll(EMAIL_RE)].map(m => m[0].toLowerCase());
  for (const email of candidates) {
    if (email.length > 80) continue;
    const [prefix, domain] = email.split('@');
    if (!domain) continue;
    if (SKIP_DOMAINS.some(d => domain.includes(d))) continue;
    if (SKIP_PREFIXES.some(p => prefix.startsWith(p))) continue;
    return email;
  }
  OBFUSCATED_RE.lastIndex = 0;
  let m;
  while ((m = OBFUSCATED_RE.exec(text)) !== null) {
    const email = `${m[1]}@${m[2]}.${m[3]}`.toLowerCase();
    const [prefix, domain] = email.split('@');
    if (!domain) continue;
    if (SKIP_DOMAINS.some(d => domain.includes(d))) continue;
    if (SKIP_PREFIXES.some(p => prefix.startsWith(p))) continue;
    return email;
  }
  return null;
}

async function fetchHtml(url, timeoutMs) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: BROWSER_HEADERS, redirect: 'follow' });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    clearTimeout(timer);
    return null;
  }
}

function extractFacebookUrl(html) {
  const m = html.match(/href=["'](https?:\/\/(?:www\.)?facebook\.com\/[a-zA-Z0-9._\-\/]{3,80})["']/);
  return m ? m[1].split('?')[0] : null;
}

// ── Puppeteer — renders JavaScript, used for Facebook ─────────────────────────

// Reuse one browser instance across requests to avoid relaunch overhead
let _browser = null;
async function getBrowser() {
  if (_browser) {
    try { await _browser.pages(); return _browser; } catch { /* crashed, relaunch */ }
  }
  _browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--disable-extensions',
    ],
  });
  return _browser;
}

// Generic Puppeteer scraper — works for any URL (websites + Facebook)
async function scrapeWithPuppeteer(targetUrl) {
  const browser = await getBrowser();
  if (!browser) return null;
  let page;
  try {
    page = await browser.newPage();
    await page.setUserAgent(BROWSER_HEADERS['User-Agent']);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

    // Block images, media, fonts to speed up load
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (['image', 'media', 'font', 'stylesheet'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });

    // Poll for mailto: link first (fastest signal)
    let email = null;
    const pollEnd = Date.now() + 8000;
    while (Date.now() < pollEnd) {
      email = await page.evaluate(() => {
        const a = document.querySelector('a[href^="mailto:"]');
        return a ? a.href.replace('mailto:', '').trim() : null;
      });
      if (email) break;
      await new Promise(r => setTimeout(r, 500));
    }

    // Fallback: scan all visible text on the page
    if (!email) {
      const text = await page.evaluate(() => document.body.innerText || '');
      email = extractEmail(text);
    }

    return email || null;
  } catch {
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

// ── scrapers ──────────────────────────────────────────────────────────────────

// Find contact/about links from the site's own navigation (dynamic — not guessing)
function findContactLinks(html, baseUrl) {
  const CONTACT_WORDS = /contact|about|reach|touch|info|support|get.in|help/i;
  const base = new URL(baseUrl);
  const seen = new Set();
  const links = [];

  for (const m of html.matchAll(/href=["']([^"'#]{2,200})["']/g)) {
    const href = m[1].trim();
    try {
      const resolved = new URL(href, baseUrl);
      // same domain only, skip images/files
      if (resolved.hostname !== base.hostname) continue;
      if (/\.(jpg|png|gif|pdf|zip|css|js)$/i.test(resolved.pathname)) continue;
      if (!CONTACT_WORDS.test(resolved.pathname) && !CONTACT_WORDS.test(href)) continue;
      const key = resolved.pathname;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push(resolved.href);
    } catch { /* skip */ }
  }

  // Also add fixed guesses in case the nav doesn't label them obviously
  for (const path of CONTACT_PATHS) {
    try {
      const fixed = new URL(path, baseUrl).href;
      if (!seen.has(new URL(path, baseUrl).pathname)) links.push(fixed);
    } catch { /* skip */ }
  }

  return links.slice(0, 8); // cap at 8 pages to check
}

async function scrapeWebsite(url) {
  // Step 1: homepage
  const html = await fetchHtml(url, TIMEOUT);
  if (!html) return { email: null, fbUrl: null };

  const fbUrl = extractFacebookUrl(html);

  const homeEmail = extractEmail(html);
  if (homeEmail) return { email: homeEmail, fbUrl };

  // Step 2: crawl contact/about links found in the site's own navigation
  const contactLinks = findContactLinks(html, url);
  for (const pageUrl of contactLinks) {
    try {
      const pageHtml = await fetchHtml(pageUrl, 8000);
      if (pageHtml) {
        const email = extractEmail(pageHtml);
        if (email) return { email, fbUrl };
        // Raw HTML had no email — page might be JS-rendered (Weebly, Wix, etc.)
        // Try Puppeteer on this specific contact page
        const jsEmail = await scrapeWithPuppeteer(pageUrl);
        if (jsEmail) return { email: jsEmail, fbUrl };
      }
    } catch { /* skip */ }
  }

  // No email found anywhere on the website → caller will try Facebook
  return { email: null, fbUrl };
}

function decodeUnicode(str) {
  // Facebook stores @ as @ and . as . in JSON blobs
  return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
}

async function scrapeFacebook(rawUrl) {
  const url = rawUrl
    .replace(/facebook\.com\/pg\//, 'facebook.com/')
    .replace(/\?.*$/, '');

  // Fetch the /about page — contact info JSON blob is in the raw HTML
  const aboutUrl = url.replace(/\/$/, '') + '/about';
  const html = await fetchHtml(aboutUrl, TIMEOUT) || await fetchHtml(url, TIMEOUT);

  if (html) {
    // Decode unicode escapes (@ → @) before scanning — this is how Facebook encodes emails
    const decoded = decodeUnicode(html);

    // Pass 1: JSON-LD blocks
    const jsonLdBlocks = decoded.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi) || [];
    for (const block of jsonLdBlocks) {
      try {
        const inner = block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '');
        const obj = JSON.parse(inner);
        const e = obj?.email || obj?.contactPoint?.email;
        if (e && typeof e === 'string' && e.includes('@')) return e.toLowerCase();
      } catch { /* skip */ }
    }

    // Pass 2: "email":"..." JSON key (after unicode decode, @ is now a real @)
    const keyMatch = decoded.match(/"email"\s*:\s*"([^"]{1,80}@[^"]{1,80})"/i);
    if (keyMatch) {
      const c = keyMatch[1].toLowerCase();
      if (!c.includes('facebook.com') && !c.includes('example')) return c;
    }

    // Pass 3: "text":"user@domain.com" pattern (how Facebook stores contact fields)
    const textMatch = decoded.match(/"text"\s*:\s*"([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})"/i);
    if (textMatch) {
      const c = textMatch[1].toLowerCase();
      if (!SKIP_DOMAINS.some(d => c.split('@')[1]?.includes(d))) return c;
    }

    // Pass 4: labeled text "Email: x@y.com"
    const labelMatch = decoded.match(/(?:e-?mail|contact)\s*[:\|]\s*([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i);
    if (labelMatch) return labelMatch[1].toLowerCase();

    // Pass 5: general regex on decoded text
    const fallback = extractEmail(decoded);
    if (fallback) return fallback;
  }

  // Last resort: full Chrome render on the /about tab
  const fbAboutUrl = url.replace(/\/$/, '') + '/about';
  return scrapeWithPuppeteer(fbAboutUrl);
}

// ── Brave search (DuckDuckGo blocks servers) ──────────────────────────────────

async function searchBrave(query) {
  const html = await fetchHtml('https://search.brave.com/search?q=' + encodeURIComponent(query), 8000);
  if (!html) return [];
  const matches = [...html.matchAll(/https?:\/\/[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\/[^\s"'<>)]{0,200}/g)];
  return [...new Set(matches.map(m => m[0].replace(/['"<>)]+$/, '')))];
}

async function findEmailBySearch(name, city) {
  // Step 1: find their Facebook page via Brave search
  const fbResults = await searchBrave(`site:facebook.com "${name}" "${city}"`);
  const fbUrl = fbResults.find(u => u.includes('facebook.com')
    && !u.includes('/search') && !u.includes('/share') && !u.includes('/login'));

  if (fbUrl) {
    const email = await scrapeFacebook(fbUrl);
    if (email) return email;
  }

  // Step 2: broader search for any contact page
  const broadResults = await searchBrave(`"${name}" "${city}" contact email`);
  for (const resultUrl of broadResults.slice(0, 5)) {
    try {
      if (/facebook\.com|instagram\.com|twitter\.com|yelp\.com/.test(resultUrl)) continue;
      const html = await fetchHtml(resultUrl, 5000);
      if (html) {
        const email = extractEmail(html);
        if (email) return email;
      }
    } catch { /* skip */ }
  }
  return null;
}

// ── endpoint ──────────────────────────────────────────────────────────────────

app.post('/api/scrape-email', async (req, res) => {
  const { url, name, city } = req.body || {};
  let email = null;
  let fbUrlFromSite = null;

  // Phase 1: scrape business website, capture FB link from it
  if (url && typeof url === 'string') {
    try {
      new URL(url);
      if (isFacebook(url)) {
        email = await scrapeFacebook(url);
      } else {
        const result = await scrapeWebsite(url);
        email = result.email;
        fbUrlFromSite = result.fbUrl;
      }
    } catch { /* invalid URL */ }
  }

  // Phase 1b: website had no email — scrape its linked Facebook page (uses Puppeteer)
  if (!email && fbUrlFromSite) {
    email = await scrapeFacebook(fbUrlFromSite);
  }

  // Phase 2: no website or still no email — search by name+city via Brave
  if (!email && name && city) {
    email = await findEmailBySearch(String(name), String(city));
  }

  res.json({ email: email || null });
});

app.get('/health', (_req, res) => res.json({ ok: true }));

// Serve config.js dynamically so the API key comes from environment variable
app.get('/config.js', (_req, res) => {
  res.type('application/javascript');
  res.send(`const CONFIG = { GOOGLE_MAPS_API_KEY: "${process.env.GOOGLE_MAPS_API_KEY || ''}" };`);
});

// Serve all other frontend files (index.html, app.js, mockData.js)
app.use(express.static(path.join(__dirname)));

app.listen(PORT, () => {
  console.log(`Place Finder running on http://localhost:${PORT}`);
});
