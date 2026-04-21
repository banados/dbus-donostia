from __future__ import annotations

"""
main.py — FastAPI backend for DBus Donostia real-time bus notifications.

Run with:
    uvicorn main:app --reload --port 8000

Serves:
    GET /api/stops    -> list of all DBus stops
    GET /api/arrivals -> real-time arrivals for a given stop_id
    /                 -> frontend static files (../frontend/)
"""

import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from dbus_client import GTFSClient

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(title="DBus Donostia Notifier", version="1.0.0")

# Allow all origins for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

client: GTFSClient | None = None


@app.on_event("startup")
async def startup_event() -> None:
    global client
    logger.info("Starting up: initialising GTFSClient and loading static GTFS data…")
    client = GTFSClient()
    # Eagerly download and parse the static GTFS zip on startup so the first
    # request to /api/stops is fast.
    client._ensure_static()
    logger.info("GTFSClient ready.")


# ------------------------------------------------------------------
# API routes
# ------------------------------------------------------------------

@app.get("/api/stops")
async def api_stops() -> JSONResponse:
    """Return all DBus stops sorted by name."""
    if client is None:
        raise HTTPException(status_code=503, detail="GTFSClient not initialised")
    stops = client.get_stops()
    return JSONResponse(content={"stops": stops, "count": len(stops)})


@app.get("/api/arrivals")
async def api_arrivals(
    stop_id: str = Query(..., description="GTFS stop_id from /api/stops")
) -> JSONResponse:
    """Return the next arrivals at the given stop."""
    if client is None:
        raise HTTPException(status_code=503, detail="GTFSClient not initialised")
    if not stop_id.strip():
        raise HTTPException(status_code=400, detail="stop_id must not be empty")
    result = client.get_arrivals(stop_id.strip())
    return JSONResponse(content=result)


@app.get("/api/line-progress")
async def api_line_progress(
    stop_id:     str = Query(..., description="GTFS stop_id of your destination stop"),
    line_name:   str = Query(..., description="Bus line short name, e.g. '26'"),
    minutes_away: int = Query(..., description="Minutes until the bus arrives at stop_id"),
) -> JSONResponse:
    """Return the ordered stops from the bus's current position to stop_id."""
    if client is None:
        raise HTTPException(status_code=503, detail="GTFSClient not initialised")
    result = client.get_line_progress(stop_id.strip(), line_name.strip(), minutes_away)
    return JSONResponse(content=result)


# ------------------------------------------------------------------
# Serve frontend static files at root "/"
# Must be mounted AFTER the API routes so /api/* takes priority.
# ------------------------------------------------------------------

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"

if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
    logger.info("Serving frontend from %s", FRONTEND_DIR)
else:
    logger.warning("Frontend directory not found at %s — skipping static mount", FRONTEND_DIR)
