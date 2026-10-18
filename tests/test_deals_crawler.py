import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scraper"))

import deals_crawler


class DealsCrawlerTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name)
        self.deals_file = self.data_dir / "deals.json"
        self.status_file = self.data_dir / "crawler_status.json"
        self.original_paths = (
            deals_crawler.DATA_DIR,
            deals_crawler.DEALS_FILE,
            deals_crawler.STATUS_FILE,
        )
        deals_crawler.DATA_DIR = self.data_dir
        deals_crawler.DEALS_FILE = self.deals_file
        deals_crawler.STATUS_FILE = self.status_file

    def tearDown(self):
        (
            deals_crawler.DATA_DIR,
            deals_crawler.DEALS_FILE,
            deals_crawler.STATUS_FILE,
        ) = self.original_paths
        self.temp_dir.cleanup()

    def test_failed_provider_keeps_existing_listings(self):
        listings = [
            {"id": "legacy", "platform": "Flipkart", "price": 100},
            {
                "id": "stale-amazon",
                "platform": "Amazon",
                "source": "amazon_paapi",
                "last_checked_at": (datetime.now().astimezone() - timedelta(days=7)).isoformat(),
                "price": 200,
            },
        ]
        self.deals_file.write_text(json.dumps(listings), encoding="utf-8")

        with patch.object(deals_crawler, "fetch_ecom_deals", side_effect=RuntimeError("not configured")):
            result = deals_crawler.run_crawler_cycle()

        saved = json.loads(self.deals_file.read_text(encoding="utf-8"))
        self.assertEqual({deal["id"] for deal in saved}, {"legacy", "stale-amazon"})
        self.assertEqual(result["platforms_active"], [])
        self.assertIn("No authorized live source", result["message"])

    def test_successful_provider_replaces_only_its_expired_records(self):
        listings = [
            {"id": "legacy", "platform": "Myntra", "price": 100},
            {
                "id": "expired-amazon",
                "platform": "Amazon",
                "source": "amazon_paapi",
                "last_checked_at": (datetime.now().astimezone() - timedelta(days=7)).isoformat(),
                "price": 200,
            },
        ]
        self.deals_file.write_text(json.dumps(listings), encoding="utf-8")
        fresh = {
            "id": "amazon_fresh",
            "platform": "Amazon",
            "source": "amazon_paapi",
            "price": 150,
            "discount_pct": 0,
            "savings": 0,
        }

        with patch.object(deals_crawler, "fetch_ecom_deals", return_value=[fresh]):
            result = deals_crawler.run_crawler_cycle()

        saved = json.loads(self.deals_file.read_text(encoding="utf-8"))
        saved_by_id = {deal["id"]: deal for deal in saved}
        self.assertIn("legacy", saved_by_id)
        self.assertNotIn("expired-amazon", saved_by_id)
        self.assertIn("amazon_fresh", saved_by_id)
        self.assertIn("last_seen", saved_by_id["amazon_fresh"])
        self.assertEqual(result["platforms_active"], ["Amazon"])


if __name__ == "__main__":
    unittest.main()
