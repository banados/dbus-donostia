import sys
import unittest
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import dbus_client


def _frozen_service_now() -> datetime:
    # Fixed local Donostia time for deterministic minutes_away calculations.
    return datetime(2026, 5, 7, 19, 25, 0)


class TestParseArrivalsHtml(unittest.TestCase):
    def setUp(self):
        self._orig_service_now = dbus_client._service_now
        dbus_client._service_now = _frozen_service_now

    def tearDown(self):
        dbus_client._service_now = self._orig_service_now

    def test_parses_legacy_minutes_format(self):
        html = (
            '<li> Linea 26: "Boulevard": 2 min.</li>'
            '<li> Linea 41: "Gros": 17 min.</li>'
        )

        arrivals = dbus_client.GTFSClient._parse_arrivals_html(html)

        self.assertEqual(
            arrivals,
            [
                {"line_name": "26", "minutes_away": 2},
                {"line_name": "41", "minutes_away": 17},
            ],
        )

    def test_parses_clock_time_format(self):
        html = (
            '<li> Linea 31: "Riberas-Pol27-Altza": 19:31</li>'
            '<li> Linea 41: "Loiola-Martutene": 19:32</li>'
            '<li> Linea 26: "Martutene": 19:35</li>'
        )

        arrivals = dbus_client.GTFSClient._parse_arrivals_html(html)

        self.assertEqual(
            arrivals,
            [
                {"line_name": "31", "minutes_away": 6},
                {"line_name": "41", "minutes_away": 7},
                {"line_name": "26", "minutes_away": 10},
            ],
        )

    def test_clock_time_rolls_to_next_day(self):
        html = '<li> Linea 5: "Centro": 00:05</li>'

        arrivals = dbus_client.GTFSClient._parse_arrivals_html(html)

        # From 19:25 to 00:05 next day => 4h40m => 280 minutes.
        self.assertEqual(arrivals, [{"line_name": "5", "minutes_away": 280}])

    def test_arriving_now_variants(self):
        html = (
            '<li> Linea 9: "Aiete": ahora</li>'
            '<li> Linea 13: "Benta Berri": orain</li>'
            '<li> Linea 17: "Gros": now</li>'
        )

        arrivals = dbus_client.GTFSClient._parse_arrivals_html(html)

        self.assertEqual(
            arrivals,
            [
                {"line_name": "9", "minutes_away": 0},
                {"line_name": "13", "minutes_away": 0},
                {"line_name": "17", "minutes_away": 0},
            ],
        )


if __name__ == "__main__":
    unittest.main()
