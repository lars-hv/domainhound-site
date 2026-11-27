import json
import sys
import unittest
from pathlib import Path
from unittest.mock import mock_open, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/sf"))
from edgar import funding, legal_key, name_index, offering_total


def filing(accession, number, sold, day="2025-01-01", previous=None, form="D"):
    return {"accession": accession, "date": day, "form": form, "file_number": number,
            "previous": previous, "sold": sold}


class FundingTests(unittest.TestCase):
    def test_legal_index_preserves_suffixes_and_collisions(self):
        names = b"EXAMPLE, INC.:0000000001:\nExample Inc:0000000002:\nExample LLC:0000000003:\n"
        matches = name_index(names, {legal_key("Example Inc.")})
        self.assertEqual(dict(matches), {"example inc": {"0000000001", "0000000002"}})

    def test_exact_name_needs_one_cik_and_independent_identity_evidence(self):
        row = {"id": 1, "domain": "example.com"}
        directory = {1: {"name": "Example, Inc.", "former_names": []}}
        form = {**filing("a", "file1", 0), "issuer": "Example Inc."}
        index = b"Example Inc:0000000001:\n"
        for raw, website, expected in [(index, "https://www.example.com", 0),
                                       (index, "https://other.example", None),
                                       (index + b"EXAMPLE INC:0000000002:\n", "https://example.com", None)]:
            with patch("pathlib.Path.open", mock_open(read_data="yc_id,legal_name,cik,source\n")), \
                    patch("edgar.sec", side_effect=[raw, json.dumps({"website": website})]), \
                    patch("edgar.filings", return_value=[form]):
                result = funding([row.copy()], directory, "2025-01-01")["companies"][0]["funding"]
                self.assertEqual(result["sold"] if result else None, expected)

    def test_amendment_replaces_original_before_summing_other_offerings(self):
        forms = [filing("a", "file1", 100), filing("b", "file1", 80, previous="a", form="D/A"),
                 filing("c", "file2", 20)]
        self.assertEqual(offering_total(forms), 100)
        self.assertEqual(offering_total([filing("zero", "file3", 0)]), 0)

    def test_missing_amount_or_unclear_amendment_is_unknown(self):
        original = filing("a", "file1", 100)
        for forms in [[], [filing("b", "file1", None)], [original, filing("b", "file1", 75)],
                      [filing("b", "file1", 75, previous="absent", form="D/A")],
                      [original, filing("b", "file2", 75, previous="a", form="D/A")]]:
            self.assertIsNone(offering_total(forms))
