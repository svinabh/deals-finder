#!/usr/bin/env python3
"""Retired legacy entry point; use the explicit Amazon PA-API connector."""

import json


if __name__ == "__main__":
    print(json.dumps({
        "status": "disabled",
        "provider": "amazon_paapi",
        "message": (
            "Legacy live search is disabled. The server now calls the official "
            "Amazon PA-API only after an explicit submitted search."
        ),
        "deals": [],
    }))
