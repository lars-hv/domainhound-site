import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("check_com", Path(__file__).resolve().parents[1] / "scripts/sf/check-com.py")
checks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checks)


class RegistryTest(unittest.TestCase):
    def test_confirms_verisign_empty_404_and_exact_name(self):
        cases = [
            ((0, '\n404'), 'unregistered'),
            ((0, '{"errorCode":404}\n404'), 'unregistered'),
            ((0, '{"ldhName":"EXAMPLE.COM"}\n200'), 'registered'),
            ((0, '{"ldhName":"DIFFERENT.COM"}\n200'), 'unknown'),
            ((0, 'upstream failure\n503'), 'unknown'),
        ]
        for reply, expected in cases:
            with self.subTest(reply=reply), patch.object(checks, "request", return_value=reply), patch.object(checks.time, "sleep"):
                self.assertEqual(checks.registration("example.com"), expected)

    def test_http_location_reaches_only_the_listed_host(self):
        with patch.object(checks.socket, "getaddrinfo", return_value=[(None, None, None, None, ("8.8.8.8",443))]):
            with patch.object(checks, "request", return_value=(0, '301\nhttps://www.example.ai/path')):
                self.assertEqual(checks.redirect("example.com", {"example.ai"}, "https"), ("redirect", "example.ai"))
            with patch.object(checks, "request", return_value=(0, '302\nhttps://example.ai.unrelated.test/')):
                self.assertEqual(checks.redirect("example.com", {"example.ai"}, "https"), ("unknown", None))
            with patch.object(checks, "request", return_value=(0, '200\n')):
                self.assertEqual(checks.redirect("example.com", {"example.ai"}, "https"), ("no_redirect", None))
            with patch.object(checks, "request", return_value=(28, '000\n')):
                self.assertEqual(checks.redirect("example.com", {"example.ai"}, "https"), ("unknown", None))
