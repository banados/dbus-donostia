/**
 * app.js — DBus Donostia frontend logic.
 *
 * - Fetches stop list from /api/stops on load.
 * - Polls /api/arrivals every 30 s when a stop is selected.
 * - Triggers browser notifications when a bus is ≤ 2 min away.
 * - Click a line card to see the bus's current position and upcoming stops.
 */

const NOTIFICATION_THRESHOLD_MINUTES = 2;
const POLL_INTERVAL_MS = 30_000;

const notifiedBuses = new Set();

let currentStopId = null;
let currentStopName = null;
let pollTimer = null;
const stopNameToId = new Map();

// DOM refs
let stopInput, stopsList, stopStatus, arrivalsSection,
    arrivalsTitle, arrivalsBoard, lastUpdated, notifyBtn, refreshDot;

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
  notifyBtn      = document.getElementById('notify-btn');
  refreshDot     = document.getElementById('refresh-indicator');

  notifyBtn.addEventListener('click', requestNotificationPermission);
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
  notifiedBuses.clear();

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
    checkNotifications(data.arrivals || []);
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

  panel.innerHTML = `
    <div class="progress-header">
      <span>Line ${escapeHtml(data.line_name)} towards ${escapeHtml(data.destination_stop)}</span>
    </div>
    <ul class="progress-stop-list">${stopsHtml}</ul>
  `;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    alert('This browser does not support notifications.');
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    notifyBtn.textContent = '🔔';
    notifyBtn.title = 'Notifications enabled';
  } else {
    notifyBtn.textContent = '🔕';
    notifyBtn.title = 'Notifications blocked';
  }
}

function checkNotifications(arrivals) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  // Clean up notified buses that are no longer in the list (they departed)
  const currentKeys = new Set(
    arrivals.map((a) => `${currentStopId}|${a.line_name}`)
  );
  for (const key of notifiedBuses) {
    if (!currentKeys.has(key)) notifiedBuses.delete(key);
  }

  for (const arrival of arrivals) {
    if (arrival.minutes_away > NOTIFICATION_THRESHOLD_MINUTES) continue;
    const key = `${currentStopId}|${arrival.line_name}`;
    if (notifiedBuses.has(key)) continue; // already notified for this bus

    notifiedBuses.add(key);
    const mins = arrival.minutes_away;
    const body = mins <= 0
      ? `Line ${arrival.line_name} is arriving NOW at ${currentStopName}`
      : `Line ${arrival.line_name} arrives in ${mins} min at ${currentStopName}`;

    new Notification('🚌 Bus arriving soon', { body, icon: '/icon-192.png' });
  }
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
