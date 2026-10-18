# Engine status and next steps

## Implemented in the current engine

- Search/ranking is separated into `search_engine.js`, with typo tolerance, common product synonyms, size and budget parsing, freshness-aware ranking, and explicit availability confidence.
- Amazon live search uses the signed, official PA-API connector in `scraper/amazon_paapi.py`; it runs only on an explicit submitted search and only works when account access and credentials are configured.
- The old Amazon HTML-search code path and hard-coded Blinkit sample results have been removed.
- Existing JSON listings remain searchable, but cached listings are no longer presented as confirmed live stock.
- Affiliate attribution is limited to the Amazon Associates tag for Amazon India links. Other stores require their own approved conversion route.
- Search and provider tests run in CI.

## Still required before calling the product a multi-store live engine

- Obtain/confirm Amazon PA-API access and verify the account's allowed request/display terms.
- Obtain approved product feeds and affiliate link rules for Flipkart, Myntra, Blinkit or other retailers, then implement and test one adapter per source.
- Add a feed timestamp/availability contract and a durable product/offer store before scaling beyond the local JSON index.
- Validate canonical product/variant matching with real listings before describing a result as the absolute best across stores.
- Add click attribution and conversion reconciliation only through approved affiliate programme mechanisms.

Do not use page scraping, sample prices, or guessed affiliate URL prefixes as substitutes for source permissions.
