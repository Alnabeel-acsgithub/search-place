const state = {
  results: [],
  isLive: false
};

const SCRAPE_API        = '/api/scrape-email';
const SCRAPE_CONCURRENCY = 5;

// ---------- Bootstrap ----------

document.addEventListener("DOMContentLoaded", () => {
  state.isLive = !!CONFIG.GOOGLE_MAPS_API_KEY;
  updateModeTag(state.isLive);

  document.getElementById("searchForm").addEventListener("submit", handleSearch);
  document.getElementById("clearBtn").addEventListener("click", clearResults);
  document.getElementById("exportBtn").addEventListener("click", exportCSV);
});

// ---------- Search ----------

async function handleSearch(e) {
  e.preventDefault();
  const keywordRaw = document.getElementById("keyword").value.trim();
  const location   = document.getElementById("location").value.trim();

  if (!keywordRaw || !location) return;

  // Support multiple comma-separated keywords
  const keywords = keywordRaw.split(",").map(k => k.trim()).filter(Boolean);

  showLoading(true);
  clearTable();

  try {
    let allPlaces = [];
    const seenIds = new Set();

    for (const kw of keywords) {
      updateLoadingText(keywords.length > 1
        ? `Searching "${kw}" (${allPlaces.length} found so far)…`
        : null);

      const results = state.isLive
        ? await searchLive(kw, location)
        : searchMock(kw, location);

      for (const place of results) {
        if (!seenIds.has(place.place_id)) {
          seenIds.add(place.place_id);
          allPlaces.push(place);
        }
      }
    }

    showLoading(false);

    if (allPlaces.length === 0) {
      showEmpty(keywordRaw, location);
      return;
    }

    if (state.isLive) {
      allPlaces = await enrichResults(allPlaces);
    }

    state.results = allPlaces;

    if (allPlaces.length === 0) {
      showEmpty(keywordRaw, location);
    } else {
      renderTable(allPlaces, keywordRaw, location, state.isLive);
    }
  } catch (err) {
    showError("Search failed: " + err.message);
  } finally {
    showLoading(false);
  }
}

// ---------- Mock Search ----------

function searchMock(keyword, location) {
  return searchMockData(keyword, location);
}

// ---------- Live Search (Places API New — single request) ----------

async function searchLive(keyword, location) {
  const fieldMask = [
    "places.id",
    "places.displayName",
    "places.formattedAddress",
    "places.addressComponents",
    "places.types",
    "places.businessStatus",
    "places.googleMapsUri",
    "places.rating",
    "places.userRatingCount",
    "places.currentOpeningHours.openNow",
    "places.nationalPhoneNumber",
    "places.websiteUri",
    "nextPageToken"
  ].join(",");

  const TARGET = 50;
  const PER_PAGE = 20;
  let allPlaces = [];
  let pageToken = null;

  while (allPlaces.length < TARGET) {
    const body = {
      textQuery: `${keyword} in ${location}`,
      maxResultCount: PER_PAGE
    };
    if (pageToken) body.pageToken = pageToken;

    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": CONFIG.GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask": fieldMask
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `API error ${res.status}`);
    }

    const data = await res.json();
    const places = (data.places || []).map(normalizePlace);
    allPlaces = allPlaces.concat(places);
    console.log(`Page fetched: ${places.length} results, total so far: ${allPlaces.length}, nextPageToken: ${data.nextPageToken ? 'yes' : 'no'}`);

    // Stop if no more pages or we hit the target
    if (!data.nextPageToken || places.length < PER_PAGE) break;
    pageToken = data.nextPageToken;
  }

  return allPlaces.slice(0, TARGET);
}

// ---------- Email Enrichment ----------

async function enrichResults(places) {
  const total = places.length;
  let done = 0;
  showEnrichmentProgress(done, total);

  for (let i = 0; i < total; i += SCRAPE_CONCURRENCY) {
    const batch = places.slice(i, i + SCRAPE_CONCURRENCY);
    await Promise.all(batch.map(async (place) => {
      try {
        const res = await fetch(SCRAPE_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: place.website || null,
            name: place.name,
            city: place.city || ""
          }),
          signal: AbortSignal.timeout(60000)
        });
        if (res.ok) {
          const data = await res.json();
          if (data.email) place.email = data.email;
        }
      } catch { /* server unreachable or timed out — skip silently */ }
      done++;
      updateEnrichmentProgress(done, total);
    }));
  }

  hideEnrichmentProgress();
  return places;
}

function showEnrichmentProgress(done, total) {
  document.getElementById('enrichmentBanner').classList.remove('hidden');
  updateEnrichmentProgress(done, total);
}

function updateEnrichmentProgress(done, total) {
  document.getElementById('enrichmentText').textContent =
    `Finding emails… ${done}/${total} places checked`;
  document.getElementById('enrichmentBar').style.width =
    `${Math.round((done / total) * 100)}%`;
}

function hideEnrichmentProgress() {
  document.getElementById('enrichmentBanner').classList.add('hidden');
}

// ---------- Normalize ----------

function normalizePlace(p) {
  const rawType = (p.types || [])[0] || "establishment";
  const categoryMap = {
    restaurant: "Restaurant",
    food_establishment: "Restaurant",
    cafe: "Restaurant",
    gym: "Gym",
    fitness_center: "Gym",
    health: "Health",
    hospital: "Hospital",
    doctor: "Doctor",
    pharmacy: "Pharmacy",
    drugstore: "Pharmacy",
    electronics_store: "Mobile Shop",
    store: "Shop",
    lodging: "Hotel",
    school: "School",
    university: "University",
    bank: "Bank",
    atm: "ATM"
  };
  const category = categoryMap[rawType] || rawType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

  const components = p.addressComponents || [];
  const cityComp =
    components.find(c => c.types?.includes("locality")) ||
    components.find(c => c.types?.includes("postal_town")) ||
    components.find(c => c.types?.includes("sublocality_level_1")) ||
    components.find(c => c.types?.includes("administrative_area_level_2")) ||
    components.find(c => c.types?.includes("administrative_area_level_1"));
  const city = cityComp?.longText || "";

  return {
    place_id: p.id,
    name: p.displayName?.text || "—",
    types: p.types || [],
    category,
    rating: p.rating || null,
    user_ratings_total: p.userRatingCount || 0,
    formatted_address: p.formattedAddress || "—",
    city,
    email: null,
    formatted_phone_number: p.nationalPhoneNumber || "—",
    website: p.websiteUri || null,
    opening_hours: { open_now: p.currentOpeningHours?.openNow ?? null },
    business_status: p.businessStatus || "OPERATIONAL",
    maps_uri: p.googleMapsUri || null
  };
}

// ---------- Render ----------

function renderTable(places, keyword, location, isLive) {
  const resultsSection = document.getElementById("resultsSection");
  const summary = document.getElementById("resultsSummary");
  const tbody = document.getElementById("tableBody");

  summary.innerHTML = `
    Found <strong>${places.length}</strong> result${places.length !== 1 ? "s" : ""}
    for <strong>"${escHtml(keyword)}"</strong> in <strong>${escHtml(location)}</strong>
    ${isLive ? '<span class="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Live Google Data</span>' : '<span class="ml-2 text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">Sample Data</span>'}
  `;

  tbody.innerHTML = places.map((p, i) => {
    const openNow = p.opening_hours?.open_now;
    const statusHtml = openNow === true
      ? `<span class="status-badge open">&#9679; Open Now</span>`
      : openNow === false
      ? `<span class="status-badge closed">&#9679; Closed</span>`
      : `<span class="status-badge unknown">&#9679; Unknown</span>`;

    const ratingHtml = p.rating
      ? `<div class="flex items-center gap-0.5 flex-wrap">
           <span class="text-yellow-400 text-xs">${starIcons(p.rating)}</span>
           <span class="font-semibold text-gray-800 text-xs ml-0.5">${p.rating}</span>
         </div>`
      : `<span class="text-gray-400 text-xs">—</span>`;

    const mapsUrl = p.maps_uri || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name + " " + p.formatted_address)}`;
    const websiteHtml = p.website
      ? `<a href="${escHtml(p.website)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-xs"><i class="fas fa-external-link-alt text-xs"></i> Visit</a>`
      : `<span class="text-gray-400 text-xs">—</span>`;

    const catColor = categoryColor(p.category);

    return `
      <tr class="hover:bg-gray-50 transition-colors border-b border-gray-100">
        <td class="px-2 py-2 text-center text-gray-500 text-xs font-medium">${i + 1}</td>
        <td class="px-2 py-2 truncate">
          <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" class="font-semibold text-gray-900 hover:text-blue-600 transition-colors text-xs" title="${escHtml(p.name)}">${escHtml(p.name)}</a>
        </td>
        <td class="px-2 py-2">
          <span class="category-badge ${catColor}">${escHtml(p.category)}</span>
        </td>
        <td class="px-2 py-2">${ratingHtml}</td>
        <td class="px-2 py-2 text-gray-600 text-xs truncate" title="${escHtml(p.formatted_address)}">${escHtml(p.formatted_address)}</td>
        <td class="px-2 py-2 text-gray-700 text-xs truncate" title="${escHtml(p.city)}">${escHtml(p.city)}</td>
        <td class="px-2 py-2 text-gray-700 text-xs truncate">${escHtml(p.formatted_phone_number)}</td>
        <td class="px-2 py-2 text-xs truncate">${p.email ? `<a href="mailto:${escHtml(p.email)}" class="text-blue-600 hover:text-blue-800" title="${escHtml(p.email)}">${escHtml(p.email)}</a>` : '<span class="text-gray-400">—</span>'}</td>
        <td class="px-2 py-2">${websiteHtml}</td>
        <td class="px-2 py-2">${statusHtml}</td>
      </tr>`;
  }).join("");

  document.getElementById("exportBtn").classList.remove("hidden");
  document.getElementById("clearBtn").classList.remove("hidden");
  resultsSection.classList.remove("hidden");
}

// ---------- Helpers ----------

function starIcons(rating) {
  const full = Math.floor(rating);
  const half = rating % 1 >= 0.5;
  let stars = "★".repeat(full);
  if (half) stars += "½";
  return stars;
}

function categoryColor(cat) {
  const map = {
    Restaurant: "cat-restaurant",
    Gym: "cat-gym",
    Doctor: "cat-doctor",
    Hospital: "cat-doctor",
    Pharmacy: "cat-doctor",
    "Mobile Shop": "cat-mobile",
    Shop: "cat-mobile",
    Hotel: "cat-hotel",
    Health: "cat-gym"
  };
  return map[cat] || "cat-default";
}

function escHtml(str) {
  if (!str) return "—";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function updateModeTag(isLive) {
  const tag = document.getElementById("modeTag");
  if (isLive) {
    tag.innerHTML = `<i class="fas fa-satellite-dish mr-1"></i> Live Mode`;
    tag.className = "mode-tag live";
  } else {
    tag.innerHTML = `<i class="fas fa-database mr-1"></i> Mock Data Mode`;
    tag.className = "mode-tag mock";
  }
}

function showLoading(show) {
  document.getElementById("loadingSpinner").classList.toggle("hidden", !show);
  const btn = document.getElementById("searchBtn");
  btn.disabled = show;
  btn.innerHTML = show
    ? `<i class="fas fa-spinner fa-spin mr-2"></i>Searching...`
    : `<i class="fas fa-search mr-2"></i>Search Places`;
  if (!show) {
    const lbl = document.getElementById("loadingLabel");
    if (lbl) lbl.textContent = "Searching for places…";
  }
}

function updateLoadingText(text) {
  const lbl = document.getElementById("loadingLabel");
  if (lbl && text) lbl.textContent = text;
}

function showEmpty(keyword, location) {
  document.getElementById("resultsSection").classList.remove("hidden");
  document.getElementById("resultsSummary").innerHTML = `No results found for <strong>"${escHtml(keyword)}"</strong> in <strong>${escHtml(location)}</strong>.`;
  document.getElementById("tableBody").innerHTML = `
    <tr><td colspan="8" class="text-center py-16 text-gray-400">
      <i class="fas fa-search fa-3x mb-4 block opacity-30"></i>
      No places found. Try a different keyword or location.
    </td></tr>`;
}

function showError(msg) {
  document.getElementById("resultsSection").classList.remove("hidden");
  document.getElementById("resultsSummary").innerHTML = "";
  document.getElementById("tableBody").innerHTML = `
    <tr><td colspan="8" class="text-center py-16 text-red-400">
      <i class="fas fa-exclamation-triangle fa-2x mb-3 block"></i>
      ${escHtml(msg)}
    </td></tr>`;
}

function clearTable() {
  document.getElementById("resultsSection").classList.add("hidden");
  document.getElementById("tableBody").innerHTML = "";
  document.getElementById("resultsSummary").innerHTML = "";
  document.getElementById("exportBtn").classList.add("hidden");
}

function clearResults() {
  clearTable();
  document.getElementById("clearBtn").classList.add("hidden");
  document.getElementById("keyword").focus();
}

// ---------- CSV Export ----------

function exportCSV() {
  if (!state.results.length) return;

  const headers = ["#", "Name", "Category", "Rating", "Reviews", "Address", "City", "Phone", "Email", "Website", "Status"];
  const rows = state.results.map((p, i) => [
    i + 1,
    p.name,
    p.category,
    p.rating || "",
    p.user_ratings_total || "",
    p.formatted_address,
    p.city || "",
    p.formatted_phone_number,
    p.email || "",
    p.website || "",
    p.opening_hours?.open_now === true ? "Open" : p.opening_hours?.open_now === false ? "Closed" : "Unknown"
  ]);

  const csv = [headers, ...rows]
    .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `places_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
