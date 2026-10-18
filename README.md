# DealsFinder.AI

Hyperlocal & multi-platform deal discovery engine for India. Aggregates live high-discount deals across Amazon, Flipkart, Myntra and Blinkit, serves them through a clean search UI, and appends your affiliate tags to every outbound link.

## What it does

- **Live deal crawler** (Python) — scans discount feeds, filters out-of-stock items, standardizes deals (price, MRP, discount %, brand, size, product image) and stores them in `data/deals.json`
- **Stale-deal expiry** — deals not seen by any crawler run in 48 hours are automatically dropped, so the database only contains live offers
- **API server** (Node, zero dependencies) — search, filter (platform / discount / stock), sort, crawler trigger and status endpoints
- **Search UI** — single-box search, product-image cards, platform filter pills, min-discount and in-stock filters
- **Affiliate monetization** — Amazon `tag=` appending client-side and via `/api/convert-link`; Flipkart/Myntra/Blinkit links can be routed through EarnKaro or Cuelinks

## Project structure

```
server.js                  # Node HTTP server: static files + JSON API
public/                    # Frontend (index.html, style.css, app.js)
scraper/
  deals_crawler.py         # Master crawler: fetch → merge → expire → save
  crawler_config.json      # Thresholds, pincode, interval, caps
  scrapers/
    ecom_deals.py          # Amazon / Flipkart / Myntra feed scraper
    blinkit_deals.py       # Quick-commerce deal source
data/                      # Runtime output (deals.json, crawler_status.json) — gitignored
```

## Setup

Requirements: Node.js 14+, Python 3.9+ with `requests`.

```bash
pip install requests

# Optional: point the server at a specific Python interpreter
# (defaults to `python3` on PATH)
export PYTHON_PATH=/path/to/python

# Run a single crawl to populate the database
python3 scraper/deals_crawler.py --run-once

# Start the server
node server.js
# → http://localhost:3000
```

### Crawler modes

```bash
python3 scraper/deals_crawler.py --run-once              # single cycle
python3 scraper/deals_crawler.py --daemon                # every N hours (see config)
python3 scraper/deals_crawler.py --daemon --interval 900 # custom interval (seconds)
```

You can also trigger a scan from the UI ("Scan Deals" button) or via `POST /api/crawler/trigger`.

## API

| Endpoint | Method | Description |
|---|---|---|
| `/api/deals` | GET | Search & filter deals (`q`, `platform`, `category`, `minDiscount`, `sortBy`, `verified`) |
| `/api/stats` | GET | Totals: deal count, combined savings, avg discount, platforms |
| `/api/crawler/status` | GET | Last crawl status |
| `/api/crawler/trigger` | POST | Start a crawler run |
| `/api/convert-link` | POST | Append Amazon affiliate tag to a URL |

## Configuration

`scraper/crawler_config.json` — min discount %, max items per platform, default pincode, refresh interval, database cap.

## Disclaimer

Deal data is aggregated from third-party public sources for personal/research use. Prices and availability are not guaranteed — always verify on the store page before purchasing. Not affiliated with Amazon, Flipkart, Myntra or Blinkit.
