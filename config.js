// Minimal UI helpers to wire the frontend (non-breaking, no logic changes)
function updateModeTag(isLive) {
  const el = document.getElementById('modeTag');
  if (!el) return;
  if (isLive) {
    el.className = 'mode-tag live';
    el.innerHTML = '<i class="fas fa-location-dot mr-1"></i> Live Mode';
  } else {
    el.className = 'mode-tag mock';
    el.innerHTML = '<i class="fas fa-database mr-1"></i> Mock Mode';
  }
}

function showLoading(label) {
  document.getElementById('loadingSpinner').classList.remove('hidden');
  document.getElementById('welcomeState').classList.add('hidden');
  document.getElementById('resultsSection').classList.add('hidden');
  if (label) document.getElementById('loadingLabel').innerText = label;
}

function hideLoading() {
  document.getElementById('loadingSpinner').classList.add('hidden');
}

function renderResults(items) {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '';
  items.forEach((it, idx) => {
    const tr = document.createElement('tr');
    tr.className = 'border-b border-gray-100';
    tr.innerHTML = `
      <td class="px-2 py-3 text-center">${idx + 1}</td>
      <td class="px-2 py-3"><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(it.name + ' ' + it.formatted_address)}" target="_blank" class="text-blue-600 font-medium">${escapeHtml(it.name)}</a></td>
      <td class="px-2 py-3">${escapeHtml(it.category)}</td>
      <td class="px-2 py-3">${it.rating || ''}</td>
      <td class="px-2 py-3">${escapeHtml(it.formatted_address || '')}</td>
      <td class="px-2 py-3">${escapeHtml(it.city || '')}</td>
      <td class="px-2 py-3">${escapeHtml(it.formatted_phone_number || '')}</td>
      <td class="px-2 py-3 email-cell">${escapeHtml(it.email || '')}</td>
      <td class="px-2 py-3">
        ${it.website ? `<a href="${escapeAttr(it.website)}" title="${escapeAttr(it.website)}" target="_blank" class="text-blue-600"><i class="fas fa-globe"></i></a>` : ''}
        ${it.fbUrl ? ` <a href="${escapeAttr(it.fbUrl)}" title="Facebook" target="_blank" class="text-blue-600"><i class="fab fa-facebook"></i></a>` : ''}
        <button onclick="enrichRow('${it.place_id}', this)" class="ml-2 text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded">Enrich</button>
      </td>
      <td class="px-2 py-3">${escapeHtml(it.business_status || '')}</td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById('resultsSummary').innerText = `${items.length} results`;
  document.getElementById('exportBtn').classList.remove('hidden');
  document.getElementById('clearBtn').classList.remove('hidden');
  document.getElementById('resultsSection').classList.remove('hidden');
}

// Enrich a single row on demand using Puppeteer (stronger detection)
async function enrichRow(placeId) {
  const rows = (typeof state !== 'undefined' && state.results) ? state.results : [];
  const row = rows.find(r => r.place_id === placeId);
  if (!row) return;
  const btn = event && event.target ? event.target : null;
  if (btn) { btn.disabled = true; btn.innerText = 'Working...'; }

  try {
    const resp = await fetch('/api/enrich-places', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ places: [row], usePuppeteer: true })
    });
    if (resp.ok) {
      const data = await resp.json();
      const e = (data.results || [])[0];
      if (e) {
        row.email = e.email || row.email;
        row.fbUrl = e.fbUrl || row.fbUrl;
        renderResults(rows);
      }
    } else {
      console.warn('Enrich failed for', placeId);
    }
  } catch (err) {
    console.error(err);
  } finally {
    if (btn) { btn.disabled = false; btn.innerText = 'Enrich'; }
  }
}

// Start enrichment: fetch emails for each result and update table
async function startEnrichment() {
  const rows = (typeof state !== 'undefined' && state.results) ? state.results : [];
  if (!rows.length) return;
  document.getElementById('enrichmentBanner').classList.remove('hidden');
  document.getElementById('enrichmentText').innerText = 'Finding emails…';
  const bar = document.getElementById('enrichmentBar');
  let found = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    document.getElementById('enrichmentText').innerText = `Finding emails… (${i+1}/${rows.length})`;
    // First try lightweight HTML fetch via server
    try {
      const resp = await fetch('/api/enrich-places', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([r])
      });
      if (resp.ok) {
        const data = await resp.json();
        const e = (data.results || [])[0];
        if (e && e.email) {
          r.email = e.email;
          found++;
        } else if (e && e.fbUrl) {
          r.fbUrl = e.fbUrl;
        }
      }
      // If still no email, run Puppeteer for this row
      if (!r.email) {
        const presp = await fetch('/api/enrich-places', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ places: [r], usePuppeteer: true })
        });
        if (presp.ok) {
          const pdata = await presp.json();
          const pe = (pdata.results || [])[0];
          if (pe && pe.email) {
            r.email = pe.email;
            found++;
          }
          if (pe && pe.fbUrl) r.fbUrl = pe.fbUrl || r.fbUrl;
        }
      }
    } catch (err) {
      console.error('Enrich error for', r.place_id, err);
    }
    // Update UI for this row
    renderResults(rows);
    const pct = Math.round(((i+1)/rows.length)*100);
    bar.style.width = pct + '%';
  }
  document.getElementById('enrichmentText').innerText = `Emails found: ${found}`;
  setTimeout(() => document.getElementById('enrichmentBanner').classList.add('hidden'), 1200);
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s) {
  if (!s) return '';
  return escapeHtml(s).replace(/\s+/g, '%20');
}

async function handleSearch(evt) {
  if (evt && evt.preventDefault) evt.preventDefault();
  const kwRaw = (document.getElementById('keyword') || {}).value || '';
  const keywords = kwRaw.split(',').map(s => s.trim()).filter(Boolean);
  const loc = (document.getElementById('location') || {}).value || '';
  if (!keywords.length || !loc) return;

  showLoading(`Searching for ${keywords.join(', ')} in ${loc}…`);

    try {
    let results = [];
    // Get state from global (defined in app.js)
    const isLive = (typeof state !== 'undefined' && state.GOOGLE_API_KEY);
    
    if (isLive) {
      console.log('🔴 Live Mode: Calling /api/search-places');
      const resp = await fetch('/api/search-places', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords, location: loc })
      });
      if (resp.ok) {
        const data = await resp.json();
        results = data.results || [];
        console.log('✅ Got', results.length, 'results from Google Places');
      } else {
        const errText = await resp.text();
        console.warn('❌ Live search failed (status ' + resp.status + '):', errText);
        results = window.searchMockData ? searchMockData(kw, loc) : [];
      }
    } else {
      console.log('🟡 Mock Mode: Using mock data');
      results = window.searchMockData ? searchMockData(kw, loc) : [];
    }

    if (typeof state !== 'undefined') {
      state.results = results;
    }
    renderResults(results);
    // Kick off enrichment automatically for live results
    if (isLive && results.length) startEnrichment();
  } catch (e) {
    console.error(e);
  } finally {
    hideLoading();
  }
}

function clearResults() {
  if (typeof state !== 'undefined') {
    state.results = [];
  }
  document.getElementById('tableBody').innerHTML = '';
  document.getElementById('resultsSection').classList.add('hidden');
  document.getElementById('exportBtn').classList.add('hidden');
  document.getElementById('clearBtn').classList.add('hidden');
  document.getElementById('welcomeState').classList.remove('hidden');
}

const EXPORT_EXCLUDED_TYPES = new Set(['veterinary_care', 'pet_store', 'store', 'point_of_interest']);
const EXPORT_GENERIC_TYPES  = new Set(['point_of_interest', 'establishment', 'food', 'health', 'store', 'locality', 'political', 'premise', 'route']);

function exportCSV() {
  const rows = (typeof state !== 'undefined' && state.results) ? state.results : [];
  if (!rows.length) return;

  const exportRows = rows.filter(r => {
    const types = r.types || [];
    const primary = types.find(t => !EXPORT_GENERIC_TYPES.has(t)) || types[0] || '';
    return !EXPORT_EXCLUDED_TYPES.has(primary);
  });

  const headers = ['name','category','rating','address','city','phone','email','website','facebook','status'];
  const csv = [headers.join(',')].concat(exportRows.map(r => [r.name, r.category, r.rating, r.formatted_address, r.city, r.formatted_phone_number, r.email || '', r.website || '', r.fbUrl || '', r.business_status || ''].map(v => '"' + (String(v||'').replace(/"/g,'""')) + '"').join(',')) ).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'places.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Expose to global for inline handlers
window.updateModeTag = updateModeTag;
window.handleSearch = handleSearch;
window.clearResults = clearResults;
window.exportCSV = exportCSV;
