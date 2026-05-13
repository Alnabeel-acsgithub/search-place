// server.js
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const puppeteer = require('puppeteer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

const SKIP_DOMAINS = ['sentry.io', 'wixpress.com', 'example.com', 'facebook.com', 'google.com'];
const CONTACT_PATHS = ['/contact', '/about', '/about-us', '/contact-us', '/reach-us'];

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi;

app.use(cors());
app.use(express.json());

// ====================== EMAIL HELPERS ======================
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
    
    const res = await fetch(url, { 
      signal: controller.signal,
      headers: BROWSER_HEADERS 
    });
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

// ====================== PUPPETEER ======================
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

// ====================== MAIN SCRAPING ======================
async function scrapeWebsite(url) {
  console.log(`[Website] → ${url}`);
  const html = await fetchHtml(url);
  if (!html) return { email: null, fbUrl: null };

  const fbUrl = extractFacebookUrl(html);
  let email = extractEmail(html);

  if (email) return { email, fbUrl };

  // Try contact pages
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

// ====================== API ROUTES ======================
app.post('/api/scrape-email', async (req, res) => {
  const { url, name, city } = req.body;
  let email = null;
  let fbUrl = null;

  if (url) {
    const result = await scrapeWebsite(url);
    email = result.email;
    fbUrl = result.fbUrl;
  }

  if (!email && fbUrl) {
    email = await scrapeFacebook(fbUrl);
  }

  console.log(`✅ Final Email Found: ${email || 'Not Found'}`);
  res.json({ email: email || null });
});

app.get('/health', (req, res) => res.json({ status: "ok" }));

// ====================== SERVE FRONTEND (IMPORTANT) ======================
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 App: http://localhost:${PORT}`);
});