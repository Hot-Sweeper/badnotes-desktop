import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app
import timetable_feed


class LocalSecurityTests(unittest.TestCase):
    def setUp(self):
        self.client = app.app.test_client()

    def test_foreign_origins_hosts_and_fetch_sites_are_denied(self):
        self.assertEqual(self.client.get('/api/health', headers={'Origin': 'https://example.com'}).status_code, 403)
        self.assertEqual(self.client.get('/api/health', headers={'Host': 'example.com'}).status_code, 403)
        self.assertEqual(self.client.get('/api/health', headers={'Sec-Fetch-Site': 'cross-site'}).status_code, 403)
        self.assertEqual(self.client.get('/api/health', headers={'Origin': 'http://localhost'}).status_code, 200)

    def test_session_token_is_required_when_desktop_sets_one(self):
        with patch.dict(os.environ, {'BADNOTES_SESSION_TOKEN': 'unit-test-token'}):
            self.assertEqual(self.client.get('/api/health').status_code, 403)
            self.assertEqual(self.client.get('/api/health', headers={'X-BadNotes-Token': 'wrong'}).status_code, 403)
            self.assertEqual(self.client.get('/api/health', headers={'X-BadNotes-Token': 'unit-test-token'}).status_code, 200)
            self.client.set_cookie('badnotes-session', 'unit-test-token')
            self.assertEqual(self.client.get('/api/health').status_code, 200)

    def test_parent_traversal_and_restart_are_blocked(self):
        self.assertEqual(self.client.get('/api/notebooks/../pages/demo').status_code, 400)
        self.assertEqual(self.client.get('/api/fonts/..').status_code, 400)
        self.assertEqual(self.client.post('/api/server/restart').status_code, 409)

    def test_calendar_is_off_without_explicit_configuration(self):
        with patch.dict(os.environ, {'BADNOTES_CALENDAR_URL': ''}), patch.object(timetable_feed.requests, 'get') as get:
            result = timetable_feed.get_timetable()
            self.assertFalse(result['enabled'])
            self.assertEqual(result['events'], [])
            get.assert_not_called()

    def test_calendar_parses_timed_events_without_personal_defaults(self):
        calendar = 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:demo\nSUMMARY:Design\\, review\nDTSTART:20261015T120000Z\nDTEND:20261015T130000Z\nEND:VEVENT\nEND:VCALENDAR'
        self.assertEqual(timetable_feed.parse_calendar(calendar)[0]['subject'], 'Design, review')


if __name__ == '__main__':
    unittest.main()
