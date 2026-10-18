#!/usr/bin/env python3
"""Refresh configured, authorized merchant sources into the local deal index."""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

# Add scrapers directory to path
CURRENT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(CURRENT_DIR / "scrapers"))

from ecom_deals import fetch_ecom_deals
from blinkit_deals import fetch_blinkit_deals

DATA_DIR = CURRENT_DIR.parent / "data"
DEALS_FILE = DATA_DIR / "deals.json"
STATUS_FILE = DATA_DIR / "crawler_status.json"
CONFIG_FILE = CURRENT_DIR / "crawler_config.json"

IST = timezone(timedelta(hours=5, minutes=30))

def load_config() -> dict:
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"⚠️ Error reading config: {e}")
    return {
        "min_discount_pct": 50,
        "max_items_per_platform": 60,
        "default_pincode": "283135",
        "update_interval_hours": 6,
        "max_deals_in_database": 500
    }

def load_existing_deals() -> list[dict]:
    if DEALS_FILE.exists():
        try:
            with open(DEALS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    return data
        except Exception as e:
            print(f"⚠️ Error reading deals.json: {e}")
    return []

def save_deals(deals: list[dict]):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(DEALS_FILE, "w", encoding="utf-8") as f:
        json.dump(deals, f, indent=2, ensure_ascii=False)

def update_status(status_payload: dict):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(STATUS_FILE, "w", encoding="utf-8") as f:
        json.dump(status_payload, f, indent=2)

def run_crawler_cycle(min_discount: int = 50, pincode: str = "283135") -> dict:
    start_time = time.time()
    now_ist = datetime.now(IST).strftime("%Y-%m-%d %H:%M:%S IST")
    print(f"\n=======================================================")
    print(f"Starting DealsFinder authorized-source refresh at {now_ist}")
    print(f"   Source: Amazon PA-API | Minimum listed discount: {min_discount}%")
    print(f"=======================================================")

    update_status({
        "status": "running",
        "started_at": now_ist,
        "message": "Checking configured authorized product sources..."
    })

    existing_deals = load_existing_deals()
    existing_map = {d["id"]: d for d in existing_deals if "id" in d}
    print(f"📂 Loaded {len(existing_deals)} existing deals from database.")

    # Only store data returned by an authorized provider. Other stores remain
    # unavailable until their own approved product feeds are connected.
    ecom_deals = []
    source_scan_succeeded = False
    source_errors = []
    try:
        ecom_deals = fetch_ecom_deals(
            min_discount=min_discount,
            max_items=100,
            search_queries=load_config().get("crawler_search_queries"),
        )
        source_scan_succeeded = True
    except Exception as e:
        source_errors.append(f"Amazon PA-API: {e}")
        print(f"Amazon PA-API scan failed: {e}")

    # Blinkit has no approved feed configured; its former static sample catalog
    # is intentionally not presented as live stock or pricing.
    blinkit_items = []
    try:
        blinkit_items = fetch_blinkit_deals(pincode=pincode, min_discount=20)
    except Exception as e:
        source_errors.append(f"Blinkit: {e}")
        print(f"Blinkit source error: {e}")

    scanned_total = len(ecom_deals) + len(blinkit_items)
    new_added = 0
    updated_count = 0

    # Merge into existing database
    now_iso = datetime.now(IST).isoformat()
    for deal in (ecom_deals + blinkit_items):
        deal_id = deal["id"]
        deal["last_seen"] = now_iso
        if deal_id not in existing_map:
            existing_map[deal_id] = deal
            new_added += 1
        else:
            # Replace with the fresh record so image/url/title/price all stay current
            existing_map[deal_id] = deal
            updated_count += 1

    # Expire only records owned by a source that completed this cycle. A failed
    # or unconfigured provider must not erase cached listings from other feeds.
    cutoff = datetime.now(IST) - timedelta(hours=48)
    expired_count = 0
    if source_scan_succeeded:
        for deal_id, deal in list(existing_map.items()):
            if deal.get("source") != "amazon_paapi":
                continue
            seen = deal.get("last_checked_at") or deal.get("last_seen")
            try:
                if not seen or datetime.fromisoformat(seen) < cutoff:
                    del existing_map[deal_id]
                    expired_count += 1
            except ValueError:
                del existing_map[deal_id]
                expired_count += 1
    if expired_count:
        print(f"🗑️ Removed {expired_count} stale deals not seen in the last 48h.")

    # Convert map back to list and sort by discount percentage descending
    merged_list = list(existing_map.values())
    merged_list.sort(key=lambda x: (x.get("discount_pct", 0), x.get("savings", 0)), reverse=True)

    # Cap to max limit if needed
    merged_list = merged_list[:int(load_config().get("max_deals_in_database", 500))]

    save_deals(merged_list)

    duration = round(time.time() - start_time, 2)
    completed_ist = datetime.now(IST).strftime("%Y-%m-%d %H:%M:%S IST")

    result = {
        "status": "idle",
        "last_crawled_at": completed_ist,
        "duration_seconds": duration,
        "total_deals_in_database": len(merged_list),
        "total_scanned_in_cycle": scanned_total,
        "new_deals_added": new_added,
        "deals_updated": updated_count,
        "platforms_active": ["Amazon"] if source_scan_succeeded else [],
        "source_errors": source_errors,
        "message": (
            f"Updated Amazon listings: added {new_added}, refreshed {updated_count} "
            f"in {duration}s."
            if source_scan_succeeded
            else "No authorized live source completed. Existing listings were kept; freshness is shown in search results."
        )
    }

    update_status(result)

    print(f"\nSource refresh finished in {duration}s.")
    print(f"   - Scanned: {scanned_total} deals")
    print(f"   - New Added: {new_added} deals")
    print(f"   - Updated: {updated_count} deals")
    print(f"   - Total Database: {len(merged_list)} indexed listings")
    print(f"=======================================================\n")
    return result

def main():
    parser = argparse.ArgumentParser(description="DealsFinder Live Multi-Platform Crawler")
    parser.add_argument("--run-once", action="store_true", help="Run a single crawler cycle and exit")
    parser.add_argument("--daemon", action="store_true", help="Run continuously in background daemon mode")
    parser.add_argument("--min-discount", type=int, default=None, help="Minimum discount percentage threshold")
    parser.add_argument("--pincode", type=str, default=None, help="Target delivery pincode for quick commerce")
    parser.add_argument("--interval", type=int, default=None, help="Interval in seconds for daemon mode")
    args = parser.parse_args()

    config = load_config()
    min_discount = args.min_discount if args.min_discount is not None else config.get("min_discount_pct", 0)
    pincode = args.pincode or config.get("default_pincode", "283135")
    interval = args.interval or (config.get("update_interval_hours", 6) * 3600)

    if args.daemon:
        print(f"🔄 Starting DealsFinder Crawler in DAEMON mode (Interval: {interval}s)...")
        while True:
            try:
                run_crawler_cycle(min_discount=min_discount, pincode=pincode)
            except Exception as e:
                print(f"❌ Crawler error: {e}")
            print(f"⏳ Sleeping for {interval} seconds until next scheduled run...")
            time.sleep(interval)
    else:
        # Default: run once
        run_crawler_cycle(min_discount=min_discount, pincode=pincode)

if __name__ == "__main__":
    main()
