import os
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scraper"))

import amazon_paapi


class AmazonPaapiTests(unittest.TestCase):
    def test_signing_headers_are_complete_and_stable(self):
        payload = b'{"Keywords":"headphones"}'
        now = datetime(2026, 10, 18, 18, 0, 0, tzinfo=timezone.utc)
        headers = amazon_paapi._signed_headers(
            payload,
            "test-access-key",
            "test-secret-key",
            now,
        )

        self.assertEqual(headers["X-Amz-Date"], "20261018T180000Z")
        self.assertEqual(headers["X-Amz-Target"], amazon_paapi.TARGET)
        self.assertIn("SignedHeaders=", headers["Authorization"])
        signature = headers["Authorization"].split("Signature=")[1]
        self.assertEqual(len(signature), 64)

    def test_normalize_live_listing_preserves_real_availability(self):
        item = {
            "ASIN": "B012345678",
            "ItemInfo": {
                "Title": {"DisplayValue": "Wireless Headphones"},
                "ByLineInfo": {"Brand": {"DisplayValue": "Example"}},
            },
            "Offers": {
                "Listings": [{
                    "Price": {"Amount": 2400},
                    "SavingBasis": {"Amount": 3000},
                    "Availability": {"Message": "In Stock"},
                }]
            },
            "Images": {"Primary": {"Large": {"URL": "https://images.example/item.jpg"}}},
        }

        deal = amazon_paapi.normalize_item(item, "2026-10-18T23:30:00+05:30")

        self.assertEqual(deal["price"], 2400)
        self.assertEqual(deal["mrp"], 3000)
        self.assertEqual(deal["discount_pct"], 20)
        self.assertEqual(deal["availability_status"], "in_stock")
        self.assertEqual(deal["source"], "amazon_paapi")

    def test_missing_listing_price_is_not_returned_as_a_deal(self):
        item = {
            "ASIN": "B012345678",
            "ItemInfo": {"Title": {"DisplayValue": "Wireless Headphones"}},
            "Offers": {"Listings": []},
        }
        self.assertIsNone(amazon_paapi.normalize_item(item, "2026-10-18T23:30:00+05:30"))

    def test_cli_without_credentials_reports_provider_unavailable(self):
        original = {
            key: os.environ.pop(key, None)
            for key in ("AMAZON_ACCESS_KEY", "AMAZON_SECRET_KEY", "AMAZON_PARTNER_TAG")
        }
        try:
            with self.assertRaises(amazon_paapi.ProviderError):
                amazon_paapi.credentials()
        finally:
            for key, value in original.items():
                if value is not None:
                    os.environ[key] = value


if __name__ == "__main__":
    unittest.main()
