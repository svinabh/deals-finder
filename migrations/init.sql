-- Initial schema for DealsFinder

-- merchants/stores
CREATE TABLE IF NOT EXISTS merchants (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- canonical products
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  merchant_id INTEGER REFERENCES merchants(id) ON DELETE SET NULL,
  merchant_sku TEXT,
  title TEXT,
  brand TEXT,
  category TEXT,
  subcategory TEXT,
  attributes JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE (merchant_id, merchant_sku)
);

-- deals / offers (current snapshot)
CREATE TABLE IF NOT EXISTS deals (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  merchant_link TEXT NOT NULL,
  price NUMERIC,
  mrp NUMERIC,
  discount_pct INTEGER,
  savings NUMERIC,
  in_stock BOOLEAN DEFAULT TRUE,
  currency TEXT DEFAULT 'INR',
  last_seen TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- price history log
CREATE TABLE IF NOT EXISTS price_history (
  id SERIAL PRIMARY KEY,
  deal_id INTEGER REFERENCES deals(id) ON DELETE CASCADE,
  price NUMERIC,
  mrp NUMERIC,
  recorded_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- scraper runs
CREATE TABLE IF NOT EXISTS scraper_runs (
  id SERIAL PRIMARY KEY,
  started_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE,
  platform TEXT,
  scanned_count INTEGER,
  added_count INTEGER,
  updated_count INTEGER,
  status TEXT,
  metadata JSONB
);

-- failed items
CREATE TABLE IF NOT EXISTS failed_runs (
  id SERIAL PRIMARY KEY,
  run_id INTEGER REFERENCES scraper_runs(id) ON DELETE CASCADE,
  url TEXT,
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
