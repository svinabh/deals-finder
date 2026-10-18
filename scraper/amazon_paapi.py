#!/usr/bin/env python3
"""Amazon India Product Advertising API connector (PA-API 5.0)."""

import hashlib
import hmac
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

HOST = "webservices.amazon.in"
REGION = "eu-west-1"
SERVICE = "ProductAdvertisingAPI"
ENDPOINT = f"https://{HOST}/paapi5/searchitems"
TARGET = "com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems"
MARKETPLACE = "www.amazon.in"
IST = timezone(timedelta(hours=5, minutes=30))


def _load_local_env() -> None:
    env_file = Path(__file__).resolve().parents[1] / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        key_value = line.strip()
        if not key_value or key_value.startswith("#") or "=" not in key_value:
            continue
        key, value = key_value.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key or key in os.environ:
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        os.environ[key] = value


_load_local_env()


class ProviderError(RuntimeError):
    """An actionable Amazon provider configuration or request error."""


def credentials() -> Tuple[str, str, str]:
    access_key = os.getenv("AMAZON_ACCESS_KEY", "").strip()
    secret_key = os.getenv("AMAZON_SECRET_KEY", "").strip()
    partner_tag = os.getenv("AMAZON_PARTNER_TAG", "").strip()
    if not all((access_key, secret_key, partner_tag)):
        raise ProviderError(
            "Amazon live search is not configured. Set AMAZON_ACCESS_KEY, "
            "AMAZON_SECRET_KEY, and AMAZON_PARTNER_TAG after PA-API access is approved."
        )
    return access_key, secret_key, partner_tag


def _hmac(key: bytes, message: str) -> bytes:
    return hmac.new(key, message.encode("utf-8"), hashlib.sha256).digest()


def _signing_key(secret_key: str, date_stamp: str) -> bytes:
    date_key = _hmac(("AWS4" + secret_key).encode("utf-8"), date_stamp)
    region_key = hmac.new(date_key, REGION.encode("utf-8"), hashlib.sha256).digest()
    service_key = hmac.new(region_key, SERVICE.encode("utf-8"), hashlib.sha256).digest()
    return hmac.new(service_key, b"aws4_request", hashlib.sha256).digest()


def _signed_headers(payload: bytes, access_key: str, secret_key: str, now: datetime) -> dict[str, str]:
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    canonical_headers = (
        "content-encoding:amz-1.0\n"
        "content-type:application/json; charset=utf-8\n"
        f"host:{HOST}\n"
        f"x-amz-date:{amz_date}\n"
        f"x-amz-target:{TARGET}\n"
    )
    signed_headers = "content-encoding;content-type;host;x-amz-date;x-amz-target"
    canonical_request = "\n".join((
        "POST",
        "/paapi5/searchitems",
        "",
        canonical_headers,
        signed_headers,
        hashlib.sha256(payload).hexdigest(),
    ))
    scope = f"{date_stamp}/{REGION}/{SERVICE}/aws4_request"
    string_to_sign = "\n".join((
        "AWS4-HMAC-SHA256",
        amz_date,
        scope,
        hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
    ))
    signature = hmac.new(
        _signing_key(secret_key, date_stamp),
        string_to_sign.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    authorization = (
        "AWS4-HMAC-SHA256 "
        f"Credential={access_key}/{scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )
    return {
        "Authorization": authorization,
        "Content-Encoding": "amz-1.0",
        "Content-Type": "application/json; charset=utf-8",
        "Host": HOST,
        "X-Amz-Date": amz_date,
        "X-Amz-Target": TARGET,
    }


def _first(mapping: Dict[str, Any], *keys: str) -> Dict[str, Any]:
    for key in keys:
        value = mapping.get(key)
        if isinstance(value, dict):
            return value
    return {}


def normalize_item(item: Dict[str, Any], checked_at: str) -> Optional[Dict[str, Any]]:
    asin = str(item.get("ASIN") or "").strip()
    item_info = item.get("ItemInfo") or {}
    title = str(_first(item_info, "Title").get("DisplayValue") or "").strip()
    offers = item.get("Offers") or {}
    listings = offers.get("Listings") or []
    listing = listings[0] if listings and isinstance(listings[0], dict) else {}
    price_info = listing.get("Price") or {}
    amount = price_info.get("Amount")
    try:
        price = round(float(amount))
    except (TypeError, ValueError):
        return None
    if not asin or not title or price <= 0:
        return None

    basis_info = _first(listing, "SavingBasis", "Price")
    basis_amount = basis_info.get("Amount")
    try:
        mrp = max(price, round(float(basis_amount))) if basis_amount is not None else price
    except (TypeError, ValueError):
        mrp = price
    savings = max(0, mrp - price)
    discount = round(savings * 100 / mrp) if mrp else 0

    availability_message = str(
        (listing.get("Availability") or {}).get("Message") or ""
    ).strip()
    availability_lower = availability_message.lower()
    if any(phrase in availability_lower for phrase in ("out of stock", "currently unavailable", "unavailable")):
        availability = "out_of_stock"
    elif "in stock" in availability_lower:
        availability = "in_stock"
    else:
        availability = "unknown"

    brand_info = _first(item_info, "ByLineInfo").get("Brand") or {}
    brand = str(brand_info.get("DisplayValue") or "").strip()
    images = item.get("Images") or {}
    primary = images.get("Primary") or {}
    image = str((primary.get("Large") or {}).get("URL") or "")
    reviews = item.get("CustomerReviews") or {}
    rating_info = reviews.get("StarRating") or {}
    try:
        rating = round(float(rating_info.get("Value")), 1)
    except (TypeError, ValueError):
        rating = None

    return {
        "id": f"amazon_{asin}",
        "asin": asin,
        "title": title,
        "brand": brand,
        "category": "Amazon search results",
        "subcategory": "",
        "size": "Standard",
        "platform": "Amazon",
        "price": price,
        "mrp": mrp,
        "discount_pct": discount,
        "savings": savings,
        "in_stock": availability == "in_stock",
        "availability_status": availability,
        "availability_message": availability_message,
        "badge": "Availability checked" if availability != "unknown" else "Check availability at store",
        "url": f"https://www.amazon.in/dp/{asin}",
        "image": image,
        "pincode": "All India",
        "rating": rating,
        "source": "amazon_paapi",
        "last_checked_at": checked_at,
    }


def search_amazon(query: str, max_results: int = 10) -> Dict[str, Any]:
    access_key, secret_key, partner_tag = credentials()
    clean_query = " ".join(str(query).split())[:120]
    if not clean_query:
        raise ProviderError("Enter a product keyword to search Amazon.")
    checked_at = datetime.now(IST).isoformat()
    payload_dict = {
        "Keywords": clean_query,
        "ItemCount": max(1, min(int(max_results), 10)),
        "PartnerTag": partner_tag,
        "PartnerType": "Associates",
        "Marketplace": MARKETPLACE,
        "Resources": [
            "Images.Primary.Large",
            "ItemInfo.ByLineInfo",
            "ItemInfo.Title",
            "Offers.Listings.Availability.Message",
            "Offers.Listings.Price",
            "Offers.Listings.SavingBasis",
            "CustomerReviews.StarRating",
        ],
    }
    payload = json.dumps(payload_dict, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    headers = _signed_headers(
        payload,
        access_key,
        secret_key,
        datetime.now(timezone.utc),
    )
    request = urllib.request.Request(ENDPOINT, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=12) as response:
            response_body = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        details = error.read().decode("utf-8", errors="replace")[:1000]
        raise ProviderError(
            f"Amazon PA-API returned HTTP {error.code}. Check API access, marketplace, "
            f"rate limits, and partner tag. {details}"
        ) from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise ProviderError(f"Amazon PA-API request failed: {error}") from error

    try:
        body = json.loads(response_body)
    except json.JSONDecodeError as error:
        raise ProviderError("Amazon PA-API returned invalid JSON.") from error

    api_errors = body.get("Errors") or []
    if api_errors:
        error_codes = ", ".join(
            str(error.get("Code") or "unknown error")
            for error in api_errors
            if isinstance(error, dict)
        )
        raise ProviderError(
            f"Amazon PA-API rejected the request ({error_codes or 'unknown error'}). "
            "Check account access, request limits and marketplace settings."
        )

    items = ((body.get("SearchResult") or {}).get("Items") or [])
    deals = [
        normalized
        for item in items
        if isinstance(item, dict)
        for normalized in [normalize_item(item, checked_at)]
        if normalized is not None
    ]
    return {
        "status": "ok",
        "provider": "amazon_paapi",
        "query": clean_query,
        "checked_at": checked_at,
        "deals": deals,
    }


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"status": "error", "message": "Provide product keywords."}))
        return 2
    try:
        result = search_amazon(sys.argv[1])
    except ProviderError as error:
        print(json.dumps({"status": "unavailable", "provider": "amazon_paapi", "message": str(error)}))
        return 0
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
