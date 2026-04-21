# DBus Donostia — Real-time Bus Notifier

A Progressive Web App (PWA) that shows real-time bus arrival times for Donostiako Autobusen Zerbitzua (DBus) stops in San Sebastián / Donostia.

**Original/Inspiration Code:** Written by Diego Lauer. Transformed into a working app/code during the "AI Tools for Research Workshop" at DIPC.

## Features

- 🔍 Search any DBus stop by name or number
- 🚌 Live arrival times, refreshed every 30 seconds
- 📍 Click any arriving bus to see its current position and the stops between it and yours
- 🔔 Browser notifications when a bus is 2 minutes away
- 📱 Installable as a PWA on iPhone/Android (Add to Home Screen)

## How it works

The backend (FastAPI) fetches real-time arrival data from the dbus.eus website and static route/stop data from the official GTFS feed published by the Basque Government. The frontend is served directly by the backend — no separate hosting needed.

## Local setup

**Requirements**: Python 3.9+

```bash
pip install -r dbus-notifier/backend/requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --app-dir dbus-notifier/backend
```