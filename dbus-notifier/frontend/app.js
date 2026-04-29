/**
 * app.js — DBus Donostia frontend logic.
 *
 * - Fetches stop list from /api/stops on load.
 * - Polls /api/arrivals every 30 s when a stop is selected.
 * - Click a line card to see the bus's current position and upcoming stops.
 */

const POLL_INTERVAL_MS = 30_000;

let currentStopId = null;
let currentStopName = null;
let pollTimer = null;
const stopNameToId = new Map();
let stopsCache = [];  // full stop objects with lat/lon for nearest-stop search

// DOM refs
let stopInput, stopsList, stopStatus, arrivalsSection,
    arrivalsTitle, arrivalsBoard, lastUpdated, refreshDot,
    locateBtn, nearestStopsDiv;

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  stopInput      = document.getElementById('stop-input');
  stopsList      = document.getElementById('stops-list');
  stopStatus     = document.getElementById('stop-status');
  arrivalsSection = document.querySelector('.arrivals-section');
  arrivalsTitle  = document.getElementById('arrivals-title');
  arrivalsBoard  = document.getElementById('arrivals-board');
  lastUpdated    = document.getElementById('last-updated');
  refreshDot     = document.getElementById('refresh-indicator');

  locateBtn       = document.getElementById('locate-btn');
  nearestStopsDiv = document.getElementById('nearest-stops');
  locateBtn.addEventListener('click', onLocate);

  stopInput.addEventListener('change', onStopChanged);
  // Also handle 'input' for browsers that fire change only on blur
  stopInput.addEventListener('input', () => {
    const val = stopInput.value.trim().toLowerCase();
    const id = stopNameToId.get(val);
    if (id && id !== currentStopId) {
      onStopSelected(id, stopInput.value.trim());
    }
  });

  await loadStops();
});

// ---------------------------------------------------------------------------
// Stop loading
// ---------------------------------------------------------------------------

async function loadStops() {
  setStopStatus('Loading stops…');
  try {
    const resp = await fetch('/api/stops');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    populateDatalist(data.stops);
    setStopStatus(`${data.count} stops loaded. Type to search.`);
  } catch (err) {
    setStopStatus(`Failed to load stops: ${err.message}`);
    console.error('loadStops error:', err);
  }
}

function populateDatalist(stops) {
  stopsCache = stops;
  stopsList.innerHTML = '';
  stopNameToId.clear();
  for (const stop of stops) {
    const option = document.createElement('option');
    option.value = stop.stop_name;
    option.dataset.stopId = stop.stop_id;
    stopsList.appendChild(option);
    stopNameToId.set(stop.stop_name.toLowerCase(), stop.stop_id);
  }
}

// ---------------------------------------------------------------------------
// Stop selection
// ---------------------------------------------------------------------------

function onStopChanged() {
  const val = stopInput.value.trim();
  const id = stopNameToId.get(val.toLowerCase());
  if (id) {
    onStopSelected(id, val);
  }
}

function onStopSelected(stopId, stopName) {
  if (stopId === currentStopId) return;
  currentStopId = stopId;
  currentStopName = stopName;

  arrivalsTitle.textContent = `Next buses at ${stopName}`;
  arrivalsSection.hidden = false;
  arrivalsBoard.innerHTML = '<p class="hint">Loading…</p>';

  clearInterval(pollTimer);
  fetchArrivals();
  pollTimer = setInterval(fetchArrivals, POLL_INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// Arrivals polling
// ---------------------------------------------------------------------------

async function fetchArrivals() {
  if (!currentStopId) return;
  refreshDot.classList.add('spinning');

  try {
    const resp = await fetch(`/api/arrivals?stop_id=${encodeURIComponent(currentStopId)}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    renderArrivals(data);
    lastUpdated.textContent = `Updated ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    arrivalsBoard.innerHTML = `<p class="error">Error fetching arrivals: ${err.message}</p>`;
    console.error('fetchArrivals error:', err);
  } finally {
    refreshDot.classList.remove('spinning');
  }
}

function renderArrivals(data) {
  if (data.status === 'feed_error') {
    arrivalsBoard.innerHTML = `<p class="error">Feed error: ${data.error}</p>`;
    return;
  }
  if (data.status === 'no_data' || !data.arrivals || data.arrivals.length === 0) {
    arrivalsBoard.innerHTML = '<p class="no-arrivals">No active buses right now.</p>';
    return;
  }

  arrivalsBoard.innerHTML = data.arrivals.map((a) => {
    const mins = a.minutes_away;
    const label = mins <= 0 ? 'Now' : mins === 1 ? '1 min' : `${mins} min`;
    const urgency = mins <= 1 ? 'urgent' : mins <= 2 ? 'soon' : '';
    return `
      <div class="arrival-card ${urgency}"
           data-line="${escapeHtml(a.line_name)}"
           data-mins="${mins}">
        <div class="card-main">
          <span class="line-badge">Line ${escapeHtml(a.line_name)}</span>
          <span class="arrival-time">${label}</span>
          <button class="expand-btn" aria-label="Show bus position" title="Show bus route">›</button>
        </div>
        <div class="progress-panel" hidden></div>
      </div>`;
  }).join('');

  // Attach click handlers
  arrivalsBoard.querySelectorAll('.expand-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = btn.closest('.arrival-card');
      toggleProgress(card);
    });
  });
}

// ---------------------------------------------------------------------------
// Line progress panel
// ---------------------------------------------------------------------------

async function toggleProgress(card) {
  const panel = card.querySelector('.progress-panel');
  const btn = card.querySelector('.expand-btn');
  const isOpen = !panel.hidden;

  if (isOpen) {
    panel.hidden = true;
    btn.textContent = '›';
    btn.classList.remove('open');
    return;
  }

  panel.hidden = false;
  btn.textContent = '‹';
  btn.classList.add('open');
  panel.innerHTML = '<p class="hint progress-loading">Loading route…</p>';

  const lineName = card.dataset.line;
  const minsAway = parseInt(card.dataset.mins, 10);

  try {
    const url = `/api/line-progress?stop_id=${encodeURIComponent(currentStopId)}`
              + `&line_name=${encodeURIComponent(lineName)}`
              + `&minutes_away=${minsAway}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    renderProgressPanel(panel, data);
  } catch (err) {
    panel.innerHTML = `<p class="error">Could not load route: ${err.message}</p>`;
  }
}

function renderProgressPanel(panel, data) {
  if (data.status !== 'ok' || !data.stops || data.stops.length === 0) {
    const msg = data.status === 'no_matching_trip'
      ? 'No matching scheduled trip found (bus may be off-schedule).'
      : data.status === 'route_not_found'
      ? 'Route not found in static timetable.'
      : `No stop data (${data.status}).`;
    panel.innerHTML = `<p class="hint">${msg}</p>`;
    return;
  }

  const stopsHtml = data.stops.map((s) => {
    let cls = 'progress-stop';
    let dot = '○';
    if (s.is_current) { cls += ' current'; dot = '●'; }
    if (s.is_destination) { cls += ' destination'; dot = s.is_current ? '★' : '★'; }
    return `<li class="${cls}">
      <span class="stop-dot">${dot}</span>
      <span class="stop-name">${escapeHtml(s.stop_name)}</span>
    </li>`;
  }).join('');

  const finalStop = data.final_stop || data.destination_stop;
  const hasAfterStops = Array.isArray(data.stops_after) && data.stops_after.length > 0;

  let afterStopsHtml = '';
  if (hasAfterStops) {
    const afterItems = data.stops_after.map((s, idx) => {
      const isLast = idx === data.stops_after.length - 1;
      return `<li class="progress-stop${isLast ? ' final' : ''}">
        <span class="stop-dot">${isLast ? '■' : '○'}</span>
        <span class="stop-name">${escapeHtml(s.stop_name)}</span>
      </li>`;
    }).join('');
    afterStopsHtml = `
      <button class="more-stops-btn" aria-label="Show stops after your stop" title="Stops after your stop">⋯</button>
      <div class="after-stops-section" hidden>
        <div class="progress-header after-stops-header">Stops after your stop</div>
        <ul class="progress-stop-list after-stop-list">${afterItems}</ul>
      </div>`;
  }

  panel.innerHTML = `
    <div class="final-destination-badge">→ Final stop: ${escapeHtml(finalStop)}</div>
    <div class="progress-header">Line ${escapeHtml(data.line_name)} · stops until yours</div>
    <ul class="progress-stop-list">${stopsHtml}</ul>
    ${afterStopsHtml}
  `;

  if (hasAfterStops) {
    const moreBtn = panel.querySelector('.more-stops-btn');
    const afterSection = panel.querySelector('.after-stops-section');
    moreBtn.addEventListener('click', () => {
      const isOpen = !afterSection.hidden;
      afterSection.hidden = isOpen;
      moreBtn.textContent = isOpen ? '⋯' : '✕';
      moreBtn.classList.toggle('open', !isOpen);
    });
  }
}

// ---------------------------------------------------------------------------
// Nearest stops (geolocation)
// ---------------------------------------------------------------------------

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6_371_000; // Earth radius in metres
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function onLocate() {
  if (!navigator.geolocation) {
    showNearestMsg('Geolocation is not supported by this browser.');
    return;
  }

  locateBtn.disabled = true;
  locateBtn.textContent = '⏳ Locating…';
  nearestStopsDiv.hidden = false;
  nearestStopsDiv.innerHTML = '<p class="hint">Finding your location…</p>';

  try {
    const pos = await new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10_000,
      })
    );

    if (stopsCache.length === 0) {
      showNearestMsg('Stops not loaded yet — please wait a moment and try again.');
      return;
    }

    const { latitude, longitude } = pos.coords;
    const nearest = stopsCache
      .filter((s) => s.stop_lat && s.stop_lon)
      .map((s) => ({ ...s, dist: haversine(latitude, longitude, +s.stop_lat, +s.stop_lon) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 5);

    renderNearestStops(nearest);
  } catch (err) {
    const msgs = {
      1: 'Location access denied. Use the search above to find your stop.',
      2: 'Your location is currently unavailable. Try again or search above.',
      3: 'Location request timed out. Try again or search above.',
    };
    showNearestMsg(msgs[err.code] ?? `Location error: ${err.message}`);
  } finally {
    locateBtn.disabled = false;
    locateBtn.textContent = '📍 Find nearest stops';
  }
}

function renderNearestStops(stops) {
  const items = stops.map((s) => {
    const dist = s.dist < 1000
      ? `${Math.round(s.dist)} m`
      : `${(s.dist / 1000).toFixed(1)} km`;
    return `<button class="nearest-stop-btn"
        data-id="${escapeHtml(s.stop_id)}"
        data-name="${escapeHtml(s.stop_name)}">
      <span>${escapeHtml(s.stop_name)}</span>
      <span class="stop-dist">${dist}</span>
    </button>`;
  }).join('');

  nearestStopsDiv.innerHTML =
    `<p class="hint" style="margin-bottom:0.35rem">Nearest stops:</p>` +
    `<div class="nearest-stops">${items}</div>`;

  nearestStopsDiv.querySelectorAll('.nearest-stop-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      stopInput.value = btn.dataset.name;
      onStopSelected(btn.dataset.id, btn.dataset.name);
    });
  });
}

function showNearestMsg(msg) {
  nearestStopsDiv.hidden = false;
  nearestStopsDiv.innerHTML = `<p class="hint">${escapeHtml(msg)}</p>`;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function setStopStatus(msg) {
  stopStatus.textContent = msg;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
