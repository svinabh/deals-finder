#!/usr/bin/env python3
"""
E-Commerce Multi-Store Deal Scraper (Amazon, Flipkart, Myntra)
Fetches and standardizes live price drops with minimum 50% discount.
"""

import math
import re
import requests

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Origin": "https://buyhatke.com",
    "Referer": "https://buyhatke.com/"
}

POS_PLATFORM_MAP = {
    63: "Amazon",
    2: "Flipkart",
    111: "Myntra"
}

APPROVED_BRANDS = {
    # Footwear
    "skechers", "nike", "adidas", "puma", "red tape", "bata", "woodland", "campus", "sparx", "asics", "reebok", "crocs", "boldfit", "el paso",
    # Fashion
    "levi's", "levis", "us polo", "u.s. polo", "allen solly", "peter england", "van heusen", "wrangler", "pepe jeans", "lee", "jack & jones", "roadster", "hrx", "wrogn", "flying machine", "here&now", "anouk", "dressberry", "lee cooper",
    # Kitchen & Appliances
    "prestige", "pigeon", "bajaj", "havells", "philips", "kenstar", "crompton", "usha", "wonderchef", "digismart", "lifelong", "cello", "orient", "singer", "cadlec", "cookzie", "dice", "kapli", "minista", "everflame", "sansui", "sukya", "willerhot",
    # Personal Care & Cleaning
    "godrej", "genteel", "ezee", "surf excel", "ariel", "tide", "dettol", "lizol", "harpic", "colgate", "dove", "nivea", "himalaya", "muuchstac", "beardo", "wild stone", "bombay shaving", "kesh king",
    # Tech & Audio
    "apple", "samsung", "oneplus", "sony", "jbl", "boat", "noise", "boult", "realme", "lenovo", "asus", "acer", "hp", "zebronics", "portronics", "anker",
    # Grocery & Staples
    "tata", "fortune", "aashirvaad", "cadbury", "saffola", "amul", "eveready", "dabur"
}

BLOCKED_JUNK_WORDS = {
    "bikini", "olympiad", "iem cable", "headphone cords", "chocolate mould", "peppa pig",
    "dumpling squishy", "mystery box", "locket", "pendant", "earrings", "chain bracelet",
    "fidget sensory", "back case", "tempered glass", "screen protector", "camera protection",
    "silicone sealant", "air fryer liners", "super loud alarm", "letters to shareholders"
}

CATEGORY_KEYWORDS = {
    "Footwear & Shoes": ["shoe", "sneaker", "sandal", "loafer", "boot", "clog", "flip-flop", "footwear", "running"],
    "Fashion & Clothing": ["jean", "shirt", "t-shirt", "tshirt", "trousers", "jacket", "hoodie", "dress", "kurta", "saree", "short", "track"],
    "Household & Cleaning": ["detergent", "genteel", "surf excel", "ariel", "liquid wash", "cleaner", "harpic", "dishwash", "refill"],
    "Kitchen & Appliances": ["cooktop", "induction", "infrared", "kettle", "fryer", "blender", "mixer", "pan", "cooker"],
    "Electronics & Tech": ["earbuds", "headphone", "smartwatch", "speaker", "charger", "powerbank", "cable", "mouse"]
}

def detect_category(title: str, brand: str = "") -> tuple[str, str]:
    text = f"{title} {brand}".lower()
    for cat, kws in CATEGORY_KEYWORDS.items():
        for kw in kws:
            if kw in text:
                sub = kw.capitalize()
                return cat, sub
    return "Electronics & Lifestyle", "General"

def extract_size_or_spec(title: str) -> str:
    # Size patterns
    waist_m = re.search(r'\b(?:waist|size)\s*[:\-]?\s*([0-9]{2})\b', title, re.IGNORECASE)
    if waist_m:
        return f"Waist {waist_m.group(1)}"
    
    uk_m = re.search(r'\b(?:uk|us)\s*[:\-]?\s*([0-9]{1,2}(?:\.[0-9])?)\b', title, re.IGNORECASE)
    if uk_m:
        return f"UK {uk_m.group(1)}"
        
    kg_m = re.search(r'\b([0-9]+(?:\.[0-9]+)?\s*(?:kg|g|l|ml|litre|gm))\b', title, re.IGNORECASE)
    if kg_m:
        return kg_m.group(1).upper()
        
    w_m = re.search(r'\b([0-9]{3,4}\s*w)\b', title, re.IGNORECASE)
    if w_m:
        return w_m.group(1).upper()

    return "Standard"

def build_store_url(pos: int, pid: str) -> str:
    if pos == 63:
        return f"https://www.amazon.in/dp/{pid}"
    elif pos == 2:
        return f"https://www.flipkart.com/product/p/itme?pid={pid}"
    elif pos == 111:
        return f"https://www.myntra.com/{pid}"
    return f"https://www.amazon.in/dp/{pid}"

def fetch_ecom_deals(min_discount: int = 50, max_items: int = 80) -> list[dict]:
    """
    Scans live e-commerce discount feeds across Amazon, Flipkart, Myntra.
    """
    deals = []
    seen_ids = set()
    base_url = "https://buyhatke.com/api/bbd-deals"

    configs = [
        {"sortBy": "perc", "sortType": "DESC", "page": 1},
        {"sortBy": "score,count", "sortType": "DESC", "page": 1},
        {"sortBy": "perc", "sortType": "DESC", "page": 2},
        {"sortBy": "score,count", "sortType": "DESC", "page": 2}
    ]

    for cfg in configs:
        params = {
            "country": "India",
            "countryCode": "IN",
            "per": 50,
            **cfg
        }
        try:
            res = requests.get(base_url, headers=HEADERS, params=params, timeout=6)
            if res.status_code != 200:
                continue
            data = res.json().get("data", [])
        except Exception as e:
            print(f"⚠️ Feed error page {cfg['page']}: {e}")
            continue

        for item in data:
            if not isinstance(item, dict):
                continue
            pos = item.get("pos")
            pid = str(item.get("PID") or "").strip()
            if pos not in POS_PLATFORM_MAP or not pid or pid in seen_ids:
                continue

            try:
                price = float(item.get("price") or 0)
                avg = float(item.get("avg") or 0)
                perc = int(float(item.get("perc") or 0))
                rating = float(item.get("rating") or 4.0)
                oos = int(item.get("oos") or 0)
            except (ValueError, TypeError):
                continue

            if oos != 0 or price <= 50 or perc < min_discount:
                continue

            title = str(item.get("prod") or "").strip()
            brand = str(item.get("brand") or "").strip()
            image = str(item.get("image") or "").strip()
            if len(title) < 8:
                continue

            title_lower = title.lower()
            brand_lower = brand.lower()

            # Strictly reject blocked junk items
            if any(junk in title_lower for junk in BLOCKED_JUNK_WORDS):
                continue

            # Strictly accept only known, genuine brands and target products
            is_genuine = any(b in brand_lower or b in title_lower for b in APPROVED_BRANDS)
            if not is_genuine:
                continue

            # Compute realistic MRP from avg or perc
            if avg > price:
                mrp = round(avg)
            else:
                mrp = round(price / (1 - (perc / 100.0))) if perc < 100 else round(price * 2)

            savings = max(0, mrp - round(price))
            platform = POS_PLATFORM_MAP[pos]
            cat, subcat = detect_category(title, brand)
            size = extract_size_or_spec(title)
            store_url = build_store_url(pos, pid)

            seen_ids.add(pid)
            deal_obj = {
                "id": f"{platform.lower()}_{pid}",
                "title": title,
                "category": cat,
                "subcategory": subcat,
                "brand": brand or "Popular Brand",
                "size": size,
                "platform": platform,
                "price": round(price),
                "mrp": mrp,
                "discount_pct": perc,
                "savings": savings,
                "in_stock": True,
                "badge": f"{perc}% OFF Steal" if perc >= 70 else "Verified In-Stock",
                "url": store_url,
                "image": image,
                "pincode": "All India",
                "rating": round(rating, 1)
            }
            deals.append(deal_obj)

            if len(deals) >= max_items:
                break

        if len(deals) >= max_items:
            break

    print(f"✓ Scanned {len(deals)} verified deals from Amazon, Flipkart, Myntra")
    return deals

if __name__ == "__main__":
    results = fetch_ecom_deals(50, 10)
    for r in results[:3]:
        print(r)
