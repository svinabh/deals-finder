#!/usr/bin/env python3
"""
DealsFinder — Live Search Module
Fires a real-time search on Amazon.in for any query and merges the
results into the deals database. Runs with Python stdlib only
(no requests dependency) so any python3 can execute it.

Usage:
    python3 live_search.py "aloo bhujia" [max_items]
"""

import json
import re
import sys
import urllib.request
import urllib.parse
from datetime import datetime, timezone, timedelta
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DEALS_FILE = DATA_DIR / "deals.json"
IST = timezone(timedelta(hours=5, minutes=30))

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-IN,en;q=0.9",
    "Accept-Encoding": "identity",
}

CATEGORY_KEYWORDS = {
    "Footwear & Shoes": ["shoe", "sneaker", "sandal", "slipper", "boot", "footwear", "loafer"],
    "Fashion & Clothing": ["shirt", "tshirt", "t-shirt", "jeans", "kurta", "saree", "dress", "jacket", "trousers"],
    "Household & Cleaning": ["detergent", "shampoo", "cleaner", "harpic", "dishwash", "soap", "face wash", "toothpaste"],
    "Kitchen & Appliances": ["cooktop", "kettle", "mixer", "blender", "pan", "cooker", "fryer", "induction", "infrared"],
    "Grocery & Quick Commerce": ["bhujia", "namkeen", "aloo", "rice", "atta", "oil", "sugar", "tea", "coffee", "biscuit", "snack", "chips", "masala", "spice", "dry fruit", "almond", "ghee", "honey", "juice", "chocolate"],
    "Electronics & Tech": ["earbuds", "headphone", "smartwatch", "speaker", "charger", "powerbank", "cable", "mouse", "mobile", "laptop"],
}


def detect_category(title: str, brand: str = "") -> tuple:
    text = f"{title} {brand}".lower()
    for cat, kws in CATEGORY_KEYWORDS.items():
        for kw in kws:
            if kw in text:
                return cat, kw.title()
    return "General", "General"


def fetch_amazon_search(query: str, max_items: int = 24) -> list:
    """Scrape Amazon.in search results for a query. Returns deal dicts."""
    url = "https://www.amazon.in/s?k=" + urllib.parse.quote_plus(query)
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            html = resp.read().decode("utf-8", errors="ignore")
    except Exception as e:
        print(f"live_search: fetch failed: {e}", file=sys.stderr)
        return []

    if "api-services-support@amazon.com" in html or "Robot Check" in html:
        print("live_search: amazon bot check hit", file=sys.stderr)
        return []

    deals = []
    seen = set()

    # Product cards are delimited by data-asin containers
    blocks = re.split(r'data-asin="', html)
    for block in blocks[1:]:
        asin = block[:10]
        if not re.match(r"^[A-Z0-9]{10}$", asin) or asin in seen:
            continue

        # Title: h2 with aria-label or inner span
        t = re.search(r'<h2[^>]*aria-label="([^"]{8,300})"', block)
        if not t:
            t = re.search(r"<h2[^>]*>\s*<span[^>]*>([^<]{8,300})</span>", block)
        if not t:
            continue
        title = t.group(1).replace("&amp;", "&").replace("&quot;", '"').replace("&#39;", "'").strip()
        if title.lower().startswith("sponsored ad"):
            title = re.sub(r"^sponsored ad\s*[-–]\s*", "", title, flags=re.I)

        # Image
        img = re.search(r'src="(https://m\.media-amazon\.com/images/I/[^"]+)"', block)
        image = img.group(1) if img else ""

        # Price (current)
        p = re.search(r'<span class="a-price-whole">([\d,]+)', block)
        if not p:
            continue
        try:
            price = int(p.group(1).replace(",", ""))
        except ValueError:
            continue
        if price <= 0:
            continue

        # MRP: strike-through a-text-price block (₹ appears in a-offscreen)
        mrp = None
        m = re.search(r'class="a-price a-text-price"[^>]*>\s*<span class="a-offscreen">₹?([\d,]+)', block)
        if m:
            try:
                mrp = int(m.group(1).replace(",", ""))
            except ValueError:
                mrp = None
        if not mrp or mrp <= price:
            mrp = price

        # Rating
        r = re.search(r'a-icon-alt">([\d.]+) out of 5', block)
        rating = round(float(r.group(1)), 1) if r else None

        savings = mrp - price
        discount = int(round((savings / mrp) * 100)) if mrp > 0 else 0
        cat, subcat = detect_category(title)
        sponsored = "Sponsored" in block[:2000]

        seen.add(asin)
        deals.append({
            "id": f"amazon_{asin}",
            "title": title,
            "category": cat,
            "subcategory": subcat,
            "brand": "",
            "size": "Standard",
            "platform": "Amazon",
            "price": price,
            "mrp": mrp,
            "discount_pct": discount,
            "savings": savings,
            "in_stock": True,
            "badge": "Live Result",
            "url": f"https://www.amazon.in/dp/{asin}",
            "image": image,
            "pincode": "All India",
            "rating": rating if rating else 4.0,
            "live": True,
            "sponsored": sponsored,
            "source_query": query.lower(),
            "last_seen": datetime.now(IST).isoformat(),
        })

        if len(deals) >= max_items:
            break

    return deals


def merge_into_db(new_deals: list) -> dict:
    existing = []
    if DEALS_FILE.exists():
        try:
            existing = json.loads(DEALS_FILE.read_text(encoding="utf-8"))
        except Exception:
            existing = []

    existing_map = {d.get("id"): d for d in existing if d.get("id")}
    added = 0
    for deal in new_deals:
        did = deal["id"]
        if did in existing_map:
            # Live result always refreshes the snapshot
            existing_map[did] = deal
        else:
            existing_map[did] = deal
            added += 1

    merged = list(existing_map.values())
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DEALS_FILE.write_text(json.dumps(merged, indent=2, ensure_ascii=False), encoding="utf-8")
    return {"added": added, "returned": len(new_deals), "total": len(merged)}


def run_live_search(query: str, max_items: int = 24) -> dict:
    results = fetch_amazon_search(query, max_items)
    if results:
        stats = merge_into_db(results)
        return {"status": "ok", "query": query, **stats, "deals": results}
    return {"status": "no_results", "query": query, "added": 0, "returned": 0, "deals": []}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: live_search.py <query> [max_items]", file=sys.stderr)
        sys.exit(1)
    q = " ".join(sys.argv[1:-1]) if len(sys.argv) > 2 else sys.argv[1]
    n = int(sys.argv[-1]) if len(sys.argv) > 2 and sys.argv[-1].isdigit() else 24
    out = run_live_search(q, n)
    print(json.dumps(out, ensure_ascii=False))
