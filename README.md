# Place Finder

A web app to search for businesses and places worldwide using the Google Places API. Results include name, category, rating, address, phone, email, website, and open/closed status. Emails are enriched automatically by scraping each business's website.

---

## Features

- Search by keyword and location (e.g. "restaurants, London")
- Multiple comma-separated keywords in one search
- Auto email enrichment via website scraping and Puppeteer
- Per-row manual Enrich button for stronger detection
- Export results to CSV (excludes non-business types automatically)
- Mock mode when no API key is configured
- Live mode indicator in the header

---

## Requirements

- Node.js 18+
- Google Maps API key with the following APIs enabled:
  - Places API
  - Geocoding API

---

## Setup

**1. Clone and install dependencies**

```bash
npm install
```

**2. Create a `.env` file in the project root**

```
GOOGLE_MAPS_API_KEY=your_api_key_here
```

**3. Start the server**

```bash
npm start
```

**4. Open the app**

```
http://localhost:3001
```

> Without a `.env` file or API key the app runs in **Mock Mode** using sample data.

---

## Usage

1. Enter one or more keywords separated by commas (e.g. `gym, spa, hotel`)
2. Enter a location (e.g. `Dubai`, `New York`, `London`)
3. Click **Search Places**
4. Results load in the table — email enrichment starts automatically
5. Click **Enrich** on any row to re-run deeper email detection for that business
6. Click **Export CSV** to download the results

---

## CSV Export

The export automatically skips entries that are non-specific business types:

| Excluded type | Reason |
|---|---|
| `pet_store` | Excluded from export |
| `veterinary_care` | Excluded from export |
| `store` | Generic retail, no specific type |
| `point_of_interest` | Geographic marker, not a business |

All other specific business types (restaurants, gyms, hotels, clinics, etc.) are included.

---

## Project Structure

```
place-finder/
├── server.js       # Express server, Google Places API, email scraping
├── app.js          # App state and config loader
├── config.js       # UI logic, search, export, enrichment
├── mockData.js     # Sample data for mock mode
├── index.html      # Frontend UI
├── .env            # API key (not committed)
└── package.json
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_MAPS_API_KEY` | Yes (for live mode) | Google Maps API key |
| `PORT` | No | Server port (default: `3001`) |
