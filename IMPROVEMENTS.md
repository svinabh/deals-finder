# Improvements & Next Steps — Quick Action Plan

This branch contains a small, non-invasive starter set of improvements to move the project from a prototype to a more maintainable MVP. It focuses on:

- separating responsibilities (scraper vs runtime server)
- adding a simple production-minded scraper template
- adding a minimal DB schema to move away from data/deals.json
- adding helpful dev docs and CI checks
- providing a docker-compose example for local dev

What I added in this branch (one atomic commit):

- IMPROVEMENTS.md — short roadmap & checklist
- .env.example — environment variables to use in production/local
- docker-compose.yml — local dev stack (Postgres, Redis, web, crawler)
- migrations/init.sql — initial Postgres schema for products/deals/price_history
- scraper/requirements.txt — python deps for scrapers
- scraper/scraper_template.py — production-ready scraper template (retries, proxies, logging, sample parse)
- .github/workflows/ci.yml — lightweight CI: python syntax check + requirements install if present
- .github/PULL_REQUEST_TEMPLATE.md — PR checklist

Notes:
- These changes are intentionally non-destructive and do not modify existing server.js or scraper behavior.
- Next steps (if you want me to craft them): add DB integration in crawler, tests, sample platform scraper, open PR.
