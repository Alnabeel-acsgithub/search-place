const state = {
  results: [],
  isLive: false,
  GOOGLE_API_KEY: ""
};

const SCRAPE_API = '/api/scrape-email';
const SCRAPE_CONCURRENCY = 5;

// Load Config from Backend
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    state.GOOGLE_API_KEY = data.GOOGLE_MAPS_API_KEY || "";
    state.isLive = !!state.GOOGLE_API_KEY;
    updateModeTag(state.isLive);
    console.log(state.isLive ? "✅ Live Mode" : "ℹ️ Mock Mode");
  } catch (e) {
    console.log("⚠️ Mock Mode");
    state.isLive = false;
    updateModeTag(false);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadConfig();

  document.getElementById("searchForm").addEventListener("submit", handleSearch);
  document.getElementById("clearBtn").addEventListener("click", clearResults);
  document.getElementById("exportBtn").addEventListener("click", exportCSV);
});