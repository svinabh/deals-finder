# DealsFinder

DealsFinder is an India-focused live product-search MVP. A submitted search queries configured merchant sources and ranks only the results returned by those live sources. The local legacy listings are not used as a search-results fallback.

This is not yet a Honey-style checkout extension: it does not find or auto-apply coupon codes on retailer checkout pages. That needs a separate browser extension and authorized coupon data sources. Today the app searches available product listings, ranks matches and links users to the retailer.

The backend can optionally use an OpenAI model to translate/clarify the shopper's keywords before sending them to a merchant API. The model does not invent prices, stock, products, links, or coupons. Product facts must come from a connected merchant feed. If there is no live feed, the search returns no cached deals and tells the user why.

## Current capabilities

- Keyword matching with typo tolerance, common product synonyms, size extraction and maximum-price parsing on live API responses.
- Ranking live provider results by query relevance, listed discount, source freshness and rating; optional explicit price/discount sorts.
- Live Amazon India search only after the user submits a query and only when PA-API credentials are configured.
- Optional AI-assisted query understanding using a server-side OpenAI API key.
- Amazon listing normalization for price, saving basis, image, rating and the API-provided availability message.
- Amazon Associates tag appended only to Amazon India product links.
- Legacy JSON listings are retained for maintenance/statistics, but are deliberately excluded from user search results.
- Source status endpoint makes unavailable providers visible instead of implying that all stores are connected.
- A registry of major Indian marketplaces and quick-commerce providers makes integration and location requirements explicit.
- Every frontend search includes the selected 6-digit PIN. A merchant may still report an India-wide product link without confirming delivery to that PIN.
- Quick-commerce results are hidden unless a source confirms in-stock availability for the exact requested PIN at a recent live check.

The provider registry is an initial connector catalog, not a claim that every Indian store or PIN code has live integration. It lists Amazon India/Fresh, Flipkart/Minutes, Myntra, AJIO, Meesho, Snapdeal, Shopsy, Tata CLiQ, Nykaa, FirstCry, Lenskart, Pepperfry, Croma, Reliance Digital, JioMart/Quick, BigBasket/BBnow, Blinkit, Zepto, Swiggy Instamart, DMart Ready, and ONDC. Amazon product search requires approved PA-API credentials; every other provider needs an authorized product feed or network-participant integration. None of those feeds is configured in this repository today.

The PIN is format-checked as six digits, not checked against a postal-service master or delivery network. A PIN being accepted by the UI does not mean a retailer delivers there. Quick-commerce inventory is local and cannot be treated as a nationwide catalog. India-wide product links do not confirm delivery, price or stock for the requested PIN.

## Amazon PA-API setup

Amazon live search requires Product Advertising API access, not only an Associates account. Apply for/confirm PA-API eligibility in the Associates account, then put the issued credentials in the local `.env` file:

```dotenv
AMAZON_ACCESS_KEY=your-paapi-access-key
AMAZON_SECRET_KEY=your-paapi-secret-key
AMAZON_PARTNER_TAG=your-active-associates-tag
```

Keep `.env` private and never put keys in frontend code, source control, or screenshots. The Node server reads `.env` at startup. The partner tag is public link attribution, but the access and secret keys are credentials.

Without approved credentials, Amazon does not return results. The backend does not replace that failure with legacy saved listings. Do not substitute page scraping or undocumented retailer endpoints.

## Optional AI query understanding

AI is only a query assistant; it is not a product catalog or live-price source. Add an OpenAI API key to the server `.env` if you want the model to normalize Hindi/Hinglish or descriptive searches into retailer keywords:

```dotenv
OPENAI_API_KEY=your-server-side-api-key
OPENAI_MODEL=gpt-4o-mini
```

The key stays on the server. Search text is sent to OpenAI only when both the AI key and at least one configured live merchant source are available. Without the AI key, the original user query is sent to the merchant unchanged. Without a merchant feed, no LLM request is made and no cached products are returned.

## Run locally

Requirements: Node.js 14+ and Python 3.9+. The Amazon connector uses Python standard-library modules; crawler dependencies are in `scraper/requirements.txt`.

```bash
python3 -m pip install -r scraper/requirements.txt
node server.js
# Open http://localhost:3000
```

Type a query and press Enter or select **Find deals** to search connected merchant sources. Typing alone does not make a request. Search results contain only connected providers' responses; Amazon live-query responses are cached briefly to respect request limits.

To refresh the index with configured Amazon search terms:

```bash
python3 scraper/deals_crawler.py --run-once
```

The default seed terms live in `scraper/crawler_config.json`; override them with `AMAZON_CRAWLER_QUERIES` as a comma-separated list. Run the daemon only after checking the request limits and terms attached to your PA-API account:

```bash
python3 scraper/deals_crawler.py --daemon
```

`POST /api/crawler/trigger` starts one source scan from the UI.

## API

| Endpoint | Method | Description |
|---|---|---|
| `/api/deals?q=...&pin=283135` | GET | Live-search configured providers and rank their responses for the selected PIN |
| `/api/deals?q=...&pin=283135&live=false` | GET | Do not search; cached listings are still never returned |
| `/api/deals?minDiscount=...` | GET | Filter by minimum listed discount |
| `/api/providers?pin=283135` | GET | Report major provider integration status and whether location coverage is confirmed for a requested PIN |
| `/api/stats` | GET | Index totals |
| `/api/crawler/status` | GET | Last crawler status |
| `/api/crawler/trigger` | POST | Start a crawler run |

Search queries may include simple constraints, for example `Sony headphones under ₹5000` or `Skechers UK 7`. Constraints are parsed locally and used to filter/rank listings.

## Adding another store

Add a provider only when its merchant or affiliate network supplies product data and permits the intended use. A provider must return product identity/variant, current price, source URL, check time, PIN/fulfilment scope, and availability confidence. Add its adapter to `provider_registry.js`, preserve the source timestamp and requested PIN, and do not mark stock, delivery, or discount as verified unless the source actually verifies it. Link conversion/affiliate tracking is separate from product search; confirm each network's automation and display terms before connecting it. Do not scrape storefront pages or call undocumented mobile-app APIs as a substitute for a partner feed.

## Tests

```bash
node tests/search_engine.test.js
node tests/provider_registry.test.js
node tests/ai_search.test.js
node tests/live_search_api.test.js
python3 -m unittest discover -s tests -p 'test_*.py'
node --check server.js
node --check ai_search.js
node --check public/app.js
node --check provider_registry.js
python3 -m py_compile scraper/amazon_paapi.py scraper/deals_crawler.py scraper/scrapers/ecom_deals.py
```

Prices, offers and availability can change between a source check and checkout. Always confirm details on the retailer page. Affiliate links may earn commission; disclose this clearly where the site is published.
