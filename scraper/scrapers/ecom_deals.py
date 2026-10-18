#!/usr/bin/env python3
"""Amazon product ingestion through the official Product Advertising API."""

import os
import time
from typing import List, Optional

from amazon_paapi import ProviderError, search_amazon


DEFAULT_SEARCH_QUERIES = [
    "smartphone",
    "wireless earbuds",
    "running shoes",
]


def fetch_ecom_deals(
    min_discount: int = 0,
    max_items: int = 30,
    search_queries: Optional[List[str]] = None,
) -> List[dict]:
    if not search_queries:
        configured_queries = os.getenv("AMAZON_CRAWLER_QUERIES", "").strip()
        search_queries = (
            [query.strip() for query in configured_queries.split(",") if query.strip()]
            if configured_queries
            else DEFAULT_SEARCH_QUERIES
        )

    results = {}
    for index, query in enumerate(search_queries):
        if index:
            time.sleep(1.05)
        response = search_amazon(query, max_results=10)
        for deal in response["deals"]:
            if deal["discount_pct"] < min_discount:
                continue
            results[deal["id"]] = deal
            if len(results) >= max_items:
                return list(results.values())
    return list(results.values())


__all__ = ["ProviderError", "fetch_ecom_deals"]
