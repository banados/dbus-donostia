/**
 * app.js — DBus Donostia frontend logic.
 *
 * - Fetches stop list from /api/stops on load.
 * - Polls /api/arrivals every 30 s when a stop is selected.
 * - Click a line card to see the bus's current position and upcoming stops.
 */

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------

const STRINGS = {
  es: {
    subtitle:      'Autobuses en tiempo real',
    stopLabel:     'Parada',
    placeholder:   'Escribe una parada…',
    locateBtn:     '📍 Paradas cercanas',
    locating:      '⏳ Buscando…',
    loadingStops:  'Cargando paradas…',
    stopsLoaded:   '{n} paradas cargadas. Escribe para buscar.',
    stopsError:    'Error al cargar paradas: {e}',
    nextBuses:     'Próximos autobuses en {stop}',
    loading:       'Cargando…',
    fetchError:    'Error al obtener llegadas: {e}',
    noBuses:       'No hay autobuses activos ahora mismo.',
    dataTempIssue: 'Los datos en tiempo real no están disponibles temporalmente. Inténtalo de nuevo en breve.',
    updatedAt:     'Actualizado a las {time}',
    now:           'Ahora',
    min1:          '1 min',
    minN:          '{n} min',
    loadingRoute:  'Cargando ruta…',
    routeError:    'No se pudo cargar la ruta: {e}',
    noTrip:        'No se encontró el viaje programado (el autobús puede estar fuera de horario).',
    routeNotFound: 'Ruta no encontrada en el horario estático.',
    noStopData:    'Sin datos de parada ({s}).',
    stopsAfter:    'Paradas después de la tuya',
    finalStop:     '→ Última parada: {stop}',
    lineProgress:  'Línea {line} · paradas hasta la tuya',
    moreStopsTitle:'Paradas después de la tuya',
    findingLoc:    'Buscando tu ubicación…',
    stopsNotReady: 'Las paradas aún no están cargadas — espera un momento e inténtalo de nuevo.',
    nearestStops:  'Paradas más cercanas:',
    locDenied:     'Acceso a la ubicación denegado. Usa la búsqueda para encontrar tu parada.',
    locUnavail:    'Tu ubicación no está disponible ahora. Inténtalo de nuevo o usa la búsqueda.',
    locTimeout:    'Tiempo de espera agotado. Inténtalo de nuevo o usa la búsqueda.',
    locNoSupport:  'La geolocalización no está disponible en este navegador.',
    aboutLink:     'ℹ️ Acerca de y aviso legal',
  },
  eu: {
    subtitle:      'Autobus iristeak denbora errealean',
    stopLabel:     'Geltokia',
    placeholder:   'Idatzi geltoki bat…',
    locateBtn:     '📍 Hurbileko geltokiak',
    locating:      '⏳ Bilatzen…',
    loadingStops:  'Geltokiak kargatzen…',
    stopsLoaded:   '{n} geltoki kargatuta. Idatzi bilatzeko.',
    stopsError:    'Errorea geltokiak kargatzean: {e}',
    nextBuses:     '{stop} geltokiko hurrengo autobusak',
    loading:       'Kargatzen…',
    fetchError:    'Errorea iristeak lortzean: {e}',
    noBuses:       'Ez dago autobus aktiborik orain.',
    dataTempIssue: 'Denbora errealeko datuak aldi baterako ez daude erabilgarri. Saiatu berriro laster.',
    updatedAt:     '{time}etan eguneratua',
    now:           'Orain',
    min1:          '1 min',
    minN:          '{n} min',
    loadingRoute:  'Ibilbidea kargatzen…',
    routeError:    'Ezin da ibilbidea kargatu: {e}',
    noTrip:        'Ez da programatutako bidaia aurkitu (autobusa ordutegitik kanpo egon daiteke).',
    routeNotFound: 'Ibilbidea ez da aurkitu ordutegietan.',
    noStopData:    'Geltoki daturik ez ({s}).',
    stopsAfter:    'Zure geltokiaren ondoko geltokiak',
    finalStop:     '→ Azken geltokia: {stop}',
    lineProgress:  '{line} linea · zure geltokira arte',
    moreStopsTitle:'Zure geltokiaren ondoko geltokiak',
    findingLoc:    'Zure kokapena bilatzen…',
    stopsNotReady: 'Geltokiak oraindik ez daude kargatuta — itxaron eta saiatu berriro.',
    nearestStops:  'Hurbileko geltokiak:',
    locDenied:     'Kokapen sarbidea ukatuta. Erabili bilaketa zure geltokia aurkitzeko.',
    locUnavail:    'Zure kokapena ez dago eskuragarri. Saiatu berriro edo erabili bilaketa.',
    locTimeout:    'Kokapen eskaeraren denbora-muga gainditu da. Saiatu berriro.',
    locNoSupport:  'Geolokalizazioa ez dago onartuta nabigatzaile honetan.',
    aboutLink:     'ℹ️ Aplikazioari buruz eta oharra',
  },
  en: {
    subtitle:      'Real-time bus arrivals',
    stopLabel:     'Bus stop',
    placeholder:   'Type a stop name…',
    locateBtn:     '📍 Find nearest stops',
    locating:      '⏳ Locating…',
    loadingStops:  'Loading stops…',
    stopsLoaded:   '{n} stops loaded. Type to search.',
    stopsError:    'Failed to load stops: {e}',
    nextBuses:     'Next buses at {stop}',
    loading:       'Loading…',
    fetchError:    'Error fetching arrivals: {e}',
    noBuses:       'No active buses right now.',
    dataTempIssue: 'Real-time data is temporarily unavailable. Please try again shortly.',
    updatedAt:     'Updated {time}',
    now:           'Now',
    min1:          '1 min',
    minN:          '{n} min',
    loadingRoute:  'Loading route…',
    routeError:    'Could not load route: {e}',
    noTrip:        'No matching scheduled trip found (bus may be off-schedule).',
    routeNotFound: 'Route not found in static timetable.',
    noStopData:    'No stop data ({s}).',
    stopsAfter:    'Stops after your stop',
    finalStop:     '→ Final stop: {stop}',
    lineProgress:  'Line {line} · stops until yours',
    moreStopsTitle:'Stops after your stop',
    findingLoc:    'Finding your location…',
    stopsNotReady: 'Stops not loaded yet — please wait a moment and try again.',
    nearestStops:  'Nearest stops:',
    locDenied:     'Location access denied. Use the search above to find your stop.',
    locUnavail:    'Your location is currently unavailable. Try again or search above.',
    locTimeout:    'Location request timed out. Try again or search above.',
    locNoSupport:  'Geolocation is not supported by this browser.',
    aboutLink:     'ℹ️ About & disclaimer',
  },
};

let currentLang = localStorage.getItem('lang') || 'es';

function t(key, vars = {}) {
  let str = (STRINGS[currentLang] ?? STRINGS.es)[key] ?? STRINGS.en[key] ?? key;
  for (const [k, v] of Object.entries(vars)) str = str.replace(`{${k}}`, v);
  return str;
}

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 30_000;

let currentStopId   = null;
let currentStopName = null;
let pollTimer       = null;
let lastArrivalsData = null;
const stopNameToId  = new Map();
let stopsCache      = [];  // full stop objects with lat/lon for nearest-stop search

// DOM refs
let stopInput, stopsList, stopStatus, arrivalsSection,
    arrivalsTitle, arrivalsBoard, lastUpdated, refreshDot,
    locateBtn, nearestStopsDiv, langToggle;

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  stopInput       = document.getElementById('stop-input');
  stopsList       = document.getElementById('stops-list');
  stopStatus      = document.getElementById('stop-status');
  arrivalsSection = document.querySelector('.arrivals-section');
  arrivalsTitle   = document.getElementById('arrivals-title');
  arrivalsBoard   = document.getElementById('arrivals-board');
  lastUpdated     = document.getElementById('last-updated');
  refreshDot      = document.getElementById('refresh-indicator');
  locateBtn       = document.getElementById('locate-btn');
  nearestStopsDiv = document.getElementById('nearest-stops');
  langToggle      = document.getElementById('lang-toggle');

  locateBtn.addEventListener('click', onLocate);

  langToggle.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => setLang(btn.dataset.lang));
  });

  stopInput.addEventListener('change', onStopChanged);
  // Also handle 'input' for browsers that fire change only on blur
  stopInput.addEventListener('input', () => {
    const val = stopInput.value.trim().toLowerCase();
    const id = stopNameToId.get(val);
    if (id && id !== currentStopId) {
      onStopSelected(id, stopInput.value.trim());
    }
  });

  applyLang();
  await loadStops();
});

// ---------------------------------------------------------------------------
// Language
// ---------------------------------------------------------------------------

function setLang(lang) {
  if (!STRINGS[lang]) return;
  currentLang = lang;
  localStorage.setItem('lang', lang);
  applyLang();
}

function applyLang() {
  // Static elements with data-i18n attribute
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });

  // Input placeholder
  if (stopInput) stopInput.placeholder = t('placeholder');

  // Locate button (only when not mid-request)
  if (locateBtn && !locateBtn.disabled) locateBtn.textContent = t('locateBtn');

  // Active language highlight
  langToggle.querySelectorAll('button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.lang === currentLang);
  });

  // Arrivals title
  if (currentStopId) {
    arrivalsTitle.textContent = t('nextBuses', { stop: currentStopName });
  }

  // Footer about link
  const footerAbout = document.getElementById('footer-about');
  if (footerAbout) footerAbout.textContent = t('aboutLink');

  // Re-render arrivals board with updated labels
  if (lastArrivalsData) renderArrivals(lastArrivalsData);

  // Stop status (if stops are loaded)
  if (stopsCache.length > 0) {
    setStopStatus(t('stopsLoaded', { n: stopsCache.length }));
  }
}

// ---------------------------------------------------------------------------
// Stop loading
// ---------------------------------------------------------------------------

async function loadStops() {
  setStopStatus(t('loadingStops'));
  try {
    const resp = await fetch('/api/stops');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    populateDatalist(data.stops);
    setStopStatus(t('stopsLoaded', { n: data.count }));
  } catch (err) {
    setStopStatus(t('stopsError', { e: err.message }));
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
  currentStopId   = stopId;
  currentStopName = stopName;

  arrivalsTitle.textContent = t('nextBuses', { stop: stopName });
  arrivalsSection.hidden = false;
  arrivalsBoard.innerHTML = `<p class="hint">${t('loading')}</p>`;

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
    lastUpdated.textContent = t('updatedAt', { time: new Date().toLocaleTimeString() });
  } catch (err) {
    arrivalsBoard.innerHTML = `<p class="error">${t('fetchError', { e: err.message })}</p>`;
    console.error('fetchArrivals error:', err);
  } finally {
    refreshDot.classList.remove('spinning');
  }
}

function renderArrivals(data) {
  lastArrivalsData = data;

  if (data.status && data.status !== 'ok' && data.status !== 'no_arrivals') {
    arrivalsBoard.innerHTML = `<p class="error">${t('dataTempIssue')}</p>`;
    return;
  }
  if (!data.arrivals || data.arrivals.length === 0) {
    arrivalsBoard.innerHTML = `<p class="no-arrivals">${t('noBuses')}</p>`;
    return;
  }

  arrivalsBoard.innerHTML = data.arrivals.map((a) => {
    const mins = a.minutes_away;
    const label = mins <= 0 ? t('now') : mins === 1 ? t('min1') : t('minN', { n: mins });
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
  const btn   = card.querySelector('.expand-btn');
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
  panel.innerHTML = `<p class="hint progress-loading">${t('loadingRoute')}</p>`;

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
    panel.innerHTML = `<p class="error">${t('routeError', { e: err.message })}</p>`;
  }
}

function renderProgressPanel(panel, data) {
  if (data.status !== 'ok' || !data.stops || data.stops.length === 0) {
    const msg = data.status === 'no_matching_trip'
      ? t('noTrip')
      : data.status === 'route_not_found'
      ? t('routeNotFound')
      : t('noStopData', { s: data.status });
    panel.innerHTML = `<p class="hint">${msg}</p>`;
    return;
  }

  const stopsHtml = data.stops.map((s) => {
    let cls = 'progress-stop';
    let dot = '○';
    if (s.is_current)     { cls += ' current';     dot = '●'; }
    if (s.is_destination) { cls += ' destination'; dot = '★'; }
    return `<li class="${cls}">
      <span class="stop-dot">${dot}</span>
      <span class="stop-name">${escapeHtml(s.stop_name)}</span>
    </li>`;
  }).join('');

  const finalStop    = data.final_stop || data.destination_stop;
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
      <button class="more-stops-btn"
              aria-label="${t('moreStopsTitle')}"
              title="${t('moreStopsTitle')}">⋯</button>
      <div class="after-stops-section" hidden>
        <div class="progress-header after-stops-header">${t('stopsAfter')}</div>
        <ul class="progress-stop-list after-stop-list">${afterItems}</ul>
      </div>`;
  }

  panel.innerHTML = `
    <div class="final-destination-badge">${t('finalStop', { stop: escapeHtml(finalStop) })}</div>
    <div class="progress-header">${t('lineProgress', { line: escapeHtml(data.line_name) })}</div>
    <ul class="progress-stop-list">${stopsHtml}</ul>
    ${afterStopsHtml}
  `;

  if (hasAfterStops) {
    const moreBtn     = panel.querySelector('.more-stops-btn');
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
    showNearestMsg(t('locNoSupport'));
    return;
  }

  locateBtn.disabled = true;
  locateBtn.textContent = t('locating');
  nearestStopsDiv.hidden = false;
  nearestStopsDiv.innerHTML = `<p class="hint">${t('findingLoc')}</p>`;

  try {
    const pos = await new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10_000,
      })
    );

    if (stopsCache.length === 0) {
      showNearestMsg(t('stopsNotReady'));
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
      1: t('locDenied'),
      2: t('locUnavail'),
      3: t('locTimeout'),
    };
    showNearestMsg(msgs[err.code] ?? `${err.message}`);
  } finally {
    locateBtn.disabled = false;
    locateBtn.textContent = t('locateBtn');
  }
}

function renderNearestStops(stops) {
  const items = stops.map((s) => {
    const dist = s.dist < 1000
      ? `${Math.round(s.dist)} m`
      : `${(s.dist / 1000).toFixed(1)} km`;
    const mapsUrl = `https://www.google.com/maps/place/${encodeURIComponent(s.stop_name)}/@${s.stop_lat},${s.stop_lon},17z`;
    return `<div class="nearest-stop-row">
      <button class="nearest-stop-btn"
          data-id="${escapeHtml(s.stop_id)}"
          data-name="${escapeHtml(s.stop_name)}">
        <span>${escapeHtml(s.stop_name)}</span>
        <span class="stop-dist">${dist}</span>
      </button>
      <a class="map-link" href="${mapsUrl}" target="_blank" rel="noopener" aria-label="Open in Google Maps">🗺️</a>
    </div>`;
  }).join('');

  nearestStopsDiv.innerHTML =
    `<p class="hint" style="margin-bottom:0.35rem">${t('nearestStops')}</p>` +
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
