from __future__ import annotations

"""
dbus_client.py — DBus Donostia real-time arrivals via dbus.eus WordPress AJAX.

Real-time data source:
  POST https://dbus.eus/wp-admin/admin-ajax.php
  action=calcula_parada_single

Each stop page at https://dbus.eus/es/parada/{stop_id} contains:
  - A WordPress nonce ("security") used to authenticate AJAX calls
  - The WordPress post_id for the stop ("parada")
  - A default bus line ("linea") used as context

The AJAX response is an HTML fragment listing all imminent arrivals, e.g.:
  <li> Linea 26: "Boulevard": 2 min.</li>
  <li> Linea 41: "Gros": 17 min.</li>

Stop names / IDs come from the official GTFS static zip (for the dropdown).
"""

import csv
import io
import logging
import re
import time
import zipfile
from datetime import datetime, timezone

try:
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover - fallback only for minimal runtimes
    ZoneInfo = None

import requests

logger = logging.getLogger(__name__)

STATIC_GTFS_URL = "https://opendata.euskadi.eus/transport/moveuskadi/dbus/gtfs_dbus.zip"
DBUS_AJAX_URL = "https://dbus.eus/wp-admin/admin-ajax.php"
DBUS_STOP_URL = "https://dbus.eus/es/parada/{stop_id}"

STATIC_CACHE_TTL = 86_400        # 24 h
NONCE_CACHE_TTL = 6 * 3600       # 6 h (WordPress nonces rotate every 12–24 h)
STOP_PAGE_CACHE_TTL = 7 * 86_400 # 7 days (post_id mapping rarely changes)
MAX_ARRIVALS = 5

_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,*/*",
    "Accept-Language": "es-ES,es;q=0.9",
}

if ZoneInfo is not None:
    try:
        SERVICE_TZ = ZoneInfo("Europe/Madrid")
    except Exception:
        SERVICE_TZ = timezone.utc
else:
    SERVICE_TZ = timezone.utc


def _service_now() -> datetime:
    """Current time in DBus service timezone (Donostia / Europe-Madrid)."""
    return datetime.now(SERVICE_TZ)


class GTFSClient:
    def __init__(self) -> None:
        # Static GTFS (stop names for the frontend dropdown)
        self._stops: dict[str, dict] = {}        # stop_id → {stop_id, stop_name, stop_code}
        self._routes: dict[str, str] = {}        # route_id → route_short_name
        self._route_by_name: dict[str, list] = {} # route_short_name → [route_id, ...]
        self._trips: dict[str, str] = {}         # trip_id → route_id
        self._static_zip_bytes: bytes = b""
        self._static_loaded_at: float = 0.0

        # stop_times — loaded lazily only when line-progress is first requested
        # trip_id → [{stop_id, stop_sequence, arrival_secs}] sorted by stop_sequence
        self._trip_stop_sequences: dict[str, list] = {}
        self._trip_seqs_loaded = False

        # dbus.eus session — reused across requests to keep cookies alive
        self._session: requests.Session = self._make_session()

        # WordPress nonce cache
        self._nonce: str = ""
        self._nonce_loaded_at: float = 0.0

        # stop_id → {"post_id": str, "linea": str, "_ts": float}
        self._stop_page_cache: dict[str, dict] = {}

    # ------------------------------------------------------------------
    # Session
    # ------------------------------------------------------------------

    def _make_session(self) -> requests.Session:
        s = requests.Session()
        s.headers.update(_BROWSER_HEADERS)
        return s

    # ------------------------------------------------------------------
    # Static GTFS (stop names for the dropdown)
    # ------------------------------------------------------------------

    def _ensure_static(self) -> None:
        now = time.time()
        if self._stops and (now - self._static_loaded_at) < STATIC_CACHE_TTL:
            return
        logger.info("Downloading static GTFS zip from %s", STATIC_GTFS_URL)
        resp = requests.get(STATIC_GTFS_URL, timeout=30)
        resp.raise_for_status()
        self._static_zip_bytes = resp.content
        # Reset stop_times if zip was re-downloaded
        self._trip_stop_sequences.clear()
        self._trip_seqs_loaded = False

        with zipfile.ZipFile(io.BytesIO(self._static_zip_bytes)) as zf:
            with zf.open("stops.txt") as f:
                reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))
                self._stops = {}
                for row in reader:
                    sid = row["stop_id"].strip()
                    self._stops[sid] = {
                        "stop_id":   sid,
                        "stop_name": row.get("stop_name", "").strip(),
                        "stop_code": row.get("stop_code", "").strip(),
                        "stop_lat":  float(row.get("stop_lat", 0) or 0),
                        "stop_lon":  float(row.get("stop_lon", 0) or 0),
                    }
            logger.info("Loaded %d stops from GTFS", len(self._stops))

            with zf.open("routes.txt") as f:
                reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))
                self._routes = {}
                self._route_by_name = {}
                for row in reader:
                    rid = row["route_id"].strip()
                    name = row.get("route_short_name", rid).strip()
                    self._routes[rid] = name
                    self._route_by_name.setdefault(name, []).append(rid)
            logger.info("Loaded %d routes", len(self._routes))

            with zf.open("trips.txt") as f:
                reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))
                self._trips = {}
                for row in reader:
                    self._trips[row["trip_id"].strip()] = row["route_id"].strip()
            logger.info("Loaded %d trips", len(self._trips))

        self._static_loaded_at = time.time()

    # ------------------------------------------------------------------
    # Nonce management
    # ------------------------------------------------------------------

    def _ensure_nonce(self) -> str:
        now = time.time()
        if self._nonce and (now - self._nonce_loaded_at) < NONCE_CACHE_TTL:
            return self._nonce
        logger.info("Fetching fresh nonce from dbus.eus…")
        # Any stop page will do; stop_id=1 reliably resolves to a valid stop page
        r = self._session.get(
            DBUS_STOP_URL.format(stop_id=1), timeout=15, allow_redirects=True
        )
        r.raise_for_status()
        m = re.search(r"security\s*[=:]\s*['\"]([a-f0-9]{10})['\"]", r.text)
        if not m:
            raise RuntimeError("Could not extract nonce from dbus.eus page")
        self._nonce = m.group(1)
        self._nonce_loaded_at = time.time()
        logger.info("Nonce acquired: %s (from %s)", self._nonce, r.url)
        return self._nonce

    # ------------------------------------------------------------------
    # Stop page → WordPress post_id + default linea
    # ------------------------------------------------------------------

    def _get_stop_page_info(self, stop_id: str) -> dict:
        """Fetch the dbus.eus stop page for stop_id, return post_id + linea."""
        cached = self._stop_page_cache.get(stop_id)
        if cached and (time.time() - cached["_ts"]) < STOP_PAGE_CACHE_TTL:
            return cached

        url = DBUS_STOP_URL.format(stop_id=stop_id)
        logger.info("Fetching stop page for stop_id=%s → %s", stop_id, url)
        r = self._session.get(url, timeout=15, allow_redirects=True)

        if r.status_code != 200:
            raise RuntimeError(
                f"dbus.eus stop page returned HTTP {r.status_code} "
                f"for stop_id={stop_id} (url={url})"
            )

        html = r.text
        post_m = re.search(r"parada(?:_id)?\s*[=:]\s*(\d{3,6})", html)
        linea_m = re.search(r"linea\s*=\s*['\"]?(\d+)['\"]?", html)

        if not post_m:
            raise RuntimeError(
                f"Could not find WordPress post_id on dbus.eus stop page "
                f"for stop_id={stop_id} (resolved to {r.url})"
            )

        # Extract the GTFS stop_id from the redirect URL slug, e.g.
        # /es/parada/19-martutene-53/ → gtfs_stop_id='19'
        gtfs_m = re.search(r"/parada/(\d+)-", r.url)
        gtfs_stop_id = gtfs_m.group(1) if gtfs_m else stop_id

        info: dict = {
            "post_id":      post_m.group(1),
            "linea":        linea_m.group(1) if linea_m else "1",
            "gtfs_stop_id": gtfs_stop_id,
            "_ts":          time.time(),
        }
        self._stop_page_cache[stop_id] = info
        logger.info(
            "stop_id=%s → post_id=%s linea=%s gtfs_stop_id=%s (page: %s)",
            stop_id, info["post_id"], info["linea"], gtfs_stop_id, r.url,
        )
        return info

    # ------------------------------------------------------------------
    # Parse AJAX response HTML
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_arrivals_html(html: str) -> list[dict]:
        """
        Parse the calcula_parada_single HTML fragment for arrival lines.

        Supported formats per bus:
            <li> Linea 26: "Boulevard": 2 min.</li>
            <li> Linea 26: "Boulevard": 19:31</li>
        """
        arrivals = []
        now = _service_now()
        now_mins = now.hour * 60 + now.minute

        seen: set[tuple[str, int]] = set()

        def _add(line_name: str, minutes_away: int) -> None:
            key = (line_name, minutes_away)
            if key in seen:
                return
            seen.add(key)
            arrivals.append({"line_name": line_name, "minutes_away": minutes_away})

        # Two-colon pattern: "Linea X: <destination>: N min"
        for m in re.finditer(
            r'Linea\s+([^\s:]+)\s*:[^:]+:\s*(\d+)\s*min',
            html,
            re.IGNORECASE,
        ):
            line_name = m.group(1).rstrip(":")
            _add(line_name, int(m.group(2)))

        # Alternate format now used by dbus.eus: "Linea X: <destination>: HH:MM"
        for m in re.finditer(
            r'Linea\s+([^\s:]+)\s*:[^:]+:\s*([01]?\d|2[0-3]):([0-5]\d)\b',
            html,
            re.IGNORECASE,
        ):
            line_name = m.group(1).rstrip(":")
            h = int(m.group(2))
            minute = int(m.group(3))
            target_mins = h * 60 + minute
            delta = target_mins - now_mins
            if delta < 0:
                delta += 24 * 60
            _add(line_name, delta)

        # "Arriving now" variants
        for m in re.finditer(
            r'Linea\s+([^\s:]+)\s*:.*?(?:ahora|orain|\bnow\b|\b0\s*min)',
            html,
            re.IGNORECASE,
        ):
            line_name = m.group(1).rstrip(":")
            _add(line_name, 0)

        arrivals.sort(key=lambda a: a["minutes_away"])
        return arrivals[:MAX_ARRIVALS]

    # ------------------------------------------------------------------
    # GTFS stop_times — lazy loader for line-progress feature
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_gtfs_time(t: str) -> int:
        """Parse HH:MM:SS (hour may exceed 23 for post-midnight trips) → seconds."""
        try:
            h, m, s = t.split(":")
            return int(h) * 3600 + int(m) * 60 + int(s)
        except Exception:
            return 0

    def _ensure_trip_sequences(self) -> None:
        """Lazily load stop_times.txt and build per-trip ordered stop sequences."""
        if self._trip_seqs_loaded:
            return
        if not self._static_zip_bytes:
            self._ensure_static()

        logger.info(
            "Loading stop_times.txt from cached GTFS zip (%d bytes) — may take a moment…",
            len(self._static_zip_bytes),
        )
        raw: dict[str, list] = {}
        with zipfile.ZipFile(io.BytesIO(self._static_zip_bytes)) as zf:
            with zf.open("stop_times.txt") as f:
                reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))
                for row in reader:
                    tid = row["trip_id"].strip()
                    entry = {
                        "stop_id":       row["stop_id"].strip(),
                        "stop_sequence": int(row.get("stop_sequence", 0)),
                        "arrival_secs":  self._parse_gtfs_time(
                            row.get("arrival_time", row.get("departure_time", "0:0:0")).strip()
                        ),
                    }
                    raw.setdefault(tid, []).append(entry)

        for tid in raw:
            raw[tid].sort(key=lambda x: x["stop_sequence"])
        self._trip_stop_sequences = raw
        self._trip_seqs_loaded = True
        logger.info("stop_times loaded: %d trips", len(self._trip_stop_sequences))

    # ------------------------------------------------------------------
    # Line progress query
    # ------------------------------------------------------------------

    def get_line_progress(self, stop_id: str, line_name: str, minutes_away: int) -> dict:
        """
        Return the ordered list of stops a bus will visit before reaching stop_id.

        Algorithm:
          1. Find all trips for the named route that include stop_id.
          2. Pick the trip whose scheduled arrival at stop_id is closest to
             (now + minutes_away * 60), with a 30-min tolerance.
          3. From that trip's sequence, find the "current" stop (last stop
             whose scheduled arrival ≤ now).
          4. Return the slice from current stop to stop_id.
        """
        self._ensure_static()
        self._ensure_trip_sequences()

        # Use the GTFS stop_id (extracted from dbus.eus redirect URL slug)
        page_info = self._get_stop_page_info(stop_id)
        gtfs_stop_id = page_info.get("gtfs_stop_id", stop_id)

        route_ids = set(self._route_by_name.get(line_name, []))
        if not route_ids:
            return {"status": "route_not_found", "line_name": line_name, "stops": []}

        now = _service_now()
        now_secs = now.hour * 3600 + now.minute * 60 + now.second
        arrival_secs_est = now_secs + minutes_away * 60
        TOLERANCE = 30 * 60  # 30 minutes

        best_trip_id: str | None = None
        best_diff = float("inf")

        for trip_id, route_id in self._trips.items():
            if route_id not in route_ids:
                continue
            seq = self._trip_stop_sequences.get(trip_id)
            if not seq:
                continue
            dest = next((s for s in seq if s["stop_id"] == gtfs_stop_id), None)
            if dest is None:
                continue
            diff = abs(dest["arrival_secs"] - arrival_secs_est)
            if diff < best_diff:
                best_diff = diff
                best_trip_id = trip_id

        if best_trip_id is None or best_diff > TOLERANCE:
            logger.info(
                "No matching trip for line=%s stop_id=%s (gtfs=%s) minutes_away=%d (best_diff=%ds)",
                line_name, stop_id, gtfs_stop_id, minutes_away, best_diff,
            )
            return {"status": "no_matching_trip", "line_name": line_name, "stops": []}

        seq = self._trip_stop_sequences[best_trip_id]
        dest_idx = next(i for i, s in enumerate(seq) if s["stop_id"] == gtfs_stop_id)

        # Stops leading up to and including our destination
        relevant = seq[: dest_idx + 1]

        # Current estimated position: last stop whose scheduled time ≤ now_secs
        current_idx = 0
        for i, s in enumerate(relevant):
            if s["arrival_secs"] <= now_secs:
                current_idx = i

        result_stops = []
        for i, s in enumerate(relevant[current_idx:], start=current_idx):
            stop_info = self._stops.get(s["stop_id"], {})
            result_stops.append({
                "stop_id":        s["stop_id"],
                "stop_name":      stop_info.get("stop_name", s["stop_id"]),
                "is_current":     (i == current_idx),
                "is_destination": (s["stop_id"] == gtfs_stop_id),
            })

        # Stops after the user's destination up to the end of the trip
        stops_after = []
        for s in seq[dest_idx + 1:]:
            stop_info = self._stops.get(s["stop_id"], {})
            stops_after.append({
                "stop_id":   s["stop_id"],
                "stop_name": stop_info.get("stop_name", s["stop_id"]),
            })

        # Final stop of the trip
        last_s = seq[-1]
        final_stop_name = self._stops.get(last_s["stop_id"], {}).get(
            "stop_name", last_s["stop_id"]
        )

        logger.info(
            "line_progress: line=%s stop_id=%s (gtfs=%s) → trip=%s, %d stops ahead, "
            "%d stops after, final=%s, best_diff=%ds",
            line_name, stop_id, gtfs_stop_id, best_trip_id, len(result_stops),
            len(stops_after), final_stop_name, best_diff,
        )
        return {
            "status":           "ok",
            "line_name":        line_name,
            "current_stop":     result_stops[0]["stop_name"] if result_stops else "?",
            "destination_stop": self._stops.get(gtfs_stop_id, {}).get("stop_name", stop_id),
            "final_stop":       final_stop_name,
            "stops_after":      stops_after,
            "stops":            result_stops,
        }

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_stops(self) -> list[dict]:
        self._ensure_static()
        return sorted(self._stops.values(), key=lambda s: s["stop_name"])

    def get_arrivals(self, stop_id: str) -> dict:
        self._ensure_static()

        # 1. Get nonce (refresh if stale or expired)
        try:
            nonce = self._ensure_nonce()
        except Exception as exc:
            logger.error("Failed to get nonce: %s", exc)
            return {"status": "nonce_error", "error": str(exc), "arrivals": []}

        # 2. Get WordPress post_id for this stop (cached)
        try:
            page_info = self._get_stop_page_info(stop_id)
        except Exception as exc:
            logger.error("Failed to get stop page info for stop_id=%s: %s", stop_id, exc)
            return {"status": "stop_page_error", "error": str(exc), "arrivals": []}

        # 3. POST calcula_parada_single
        now = _service_now()
        data = {
            "action":   "calcula_parada_single",
            "security": nonce,
            "linea":    page_info["linea"],
            "parada":   page_info["post_id"],
            "dia":      now.day,
            "mes":      now.month,
            "year":     now.year,
            "hora":     now.strftime("%H"),
            "minuto":   now.strftime("%M"),
            "language": "es",
        }
        logger.info(
            "AJAX call: stop_id=%s post_id=%s linea=%s hora=%s:%s",
            stop_id, page_info["post_id"], page_info["linea"],
            data["hora"], data["minuto"],
        )
        try:
            r = self._session.post(
                DBUS_AJAX_URL,
                data=data,
                timeout=12,
                headers={"Referer": DBUS_STOP_URL.format(stop_id=stop_id)},
            )
        except Exception as exc:
            logger.error("AJAX POST failed: %s", exc)
            return {"status": "ajax_error", "error": str(exc), "arrivals": []}

        logger.info("AJAX response: HTTP %d, %d bytes", r.status_code, len(r.content))
        logger.info("AJAX body: %s", r.text[:500])

        if r.status_code != 200:
            return {
                "status": "ajax_http_error",
                "error": f"HTTP {r.status_code}",
                "arrivals": [],
            }

        # WordPress returns "0" or "-1" when nonce is stale
        if r.text.strip() in ("0", "-1", ""):
            logger.warning("Nonce rejected by WordPress — clearing and retrying next call")
            self._nonce = ""
            self._nonce_loaded_at = 0.0
            return {
                "status": "nonce_expired",
                "error": "Nonce was rejected — will refresh on next request",
                "arrivals": [],
            }

        # 4. Parse HTML fragment
        arrivals = self._parse_arrivals_html(r.text)
        logger.info("Parsed %d arrivals for stop_id=%s: %s", len(arrivals), stop_id, arrivals)

        if not arrivals and re.search(r"Linea\s+[^\s:]+\s*:", r.text, re.IGNORECASE):
            # Upstream returned line rows but none matched our parser.
            return {
                "status": "parse_mismatch",
                "error": "Upstream arrivals format changed",
                "arrivals": [],
            }

        status = "ok" if arrivals else "no_arrivals"
        return {"status": status, "arrivals": arrivals}

