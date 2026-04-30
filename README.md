# DBus Donostia

A Progressive Web App for real-time bus arrival times at DBus stops in San Sebastián / Donostia.

👉 **[dbus-donostia.onrender.com](https://dbus-donostia.onrender.com)**

## Features

- 🚌 Real-time arrivals for any stop, refreshed every 30 seconds
- 📍 "Find nearest stops" — shares your location and shows the 5 closest stops with distances
- 🗺️ Google Maps link for each nearby stop
- 🌐 ES / EU / EN language toggle (defaults to Spanish). Machine translations (from English) by Claude (Anthropic)
- 📱 Installable as a home screen app on iPhone (PWA)
- 🛣️ Tap any arriving bus to see its current position and the stops between it and yours

## How it works

The FastAPI backend fetches real-time arrival data from dbus.eus and static route/stop data from the official GTFS feed published by the Basque Government. The frontend is pure HTML/CSS/JS, served directly by the backend — no separate hosting or build step needed.

**API endpoints**

| Endpoint | Description |
|---|---|
| `GET /api/stops` | All DBus stops (name, id, coordinates) |
| `GET /api/arrivals?stop_id=` | Next arrivals at a stop |
| `GET /api/line-progress?stop_id=&line_name=&minutes_away=` | Ordered stops from bus's current position to yours |

## Local setup

**Requirements**: Python 3.9+

```bash
pip install -r dbus-notifier/backend/requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --app-dir dbus-notifier/backend
```

Then open [http://localhost:8000](http://localhost:8000).

## Built with

Python · FastAPI · GTFS open data · plain HTML/CSS/JS · deployed on [Render](https://render.com)

## Disclaimer

This is an independent personal project, unaffiliated with DBus or the official public transport services of San Sebastián. It is provided as-is, with no guarantee of continuous availability or data accuracy.

Real-time information depends on third-party data feeds outside the developer's control — if the underlying source changes or goes offline, the app may stop working without notice. Please don't rely on it for time-critical decisions.

Suggestions and bug reports are welcome via [GitHub Issues](https://github.com/banados/dbus_donostia/issues).

## Credits

Built by [Eduardo Bañados](https://github.com/banados) — a hobby project shared in good faith. Original inspiration from [Diego Lauer](https://www.diegolauer.com/).
