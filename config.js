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
      <td class="px-2 py-3">${escapeHtml(it.email || '')}</td>
      <td class="px-2 py-3">${it.website ? `<a href="${escapeAttr(it.website)}" target="_blank" class="text-blue-600"><i class="fas fa-globe"></i></a>` : ''}</td>
      <td class="px-2 py-3">${escapeHtml(it.business_status || '')}</td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById('resultsSummary').innerText = `${items.length} results`;
  document.getElementById('exportBtn').classList.remove('hidden');
  document.getElementById('clearBtn').classList.remove('hidden');
  document.getElementById('resultsSection').classList.remove('hidden');
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
  const kw = (document.getElementById('keyword') || {}).value || '';
  const loc = (document.getElementById('location') || {}).value || '';
  if (!kw || !loc) return;

  showLoading('Searching for places…');

    try {
    let results = [];
    // Get state from global (defined in app.js)
    const isLive = (typeof state !== 'undefined' && state.GOOGLE_API_KEY);
    
    if (isLive) {
      console.log('🔴 Live Mode: Calling /api/search-places');
      // Call backend live search
      const resp = await fetch('/api/search-places', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: kw, location: loc })
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

function exportCSV() {
  const rows = (typeof state !== 'undefined' && state.results) ? state.results : [];
  if (!rows.length) return;
  const headers = ['name','category','rating','address','city','phone','email','website','status'];
  const csv = [headers.join(',')].concat(rows.map(r => [r.name, r.category, r.rating, r.formatted_address, r.city, r.formatted_phone_number, r.email || '', r.website || '', r.business_status || ''].map(v => '"' + (String(v||'').replace(/"/g,'""')) + '"').join(',')) ).join('\n');
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
