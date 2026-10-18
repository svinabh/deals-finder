'use strict';

const path = require('path');

const { handleDealsRequest } = require('../search_pipeline');
const { createAmazonSearchRunner } = require('../amazon_live_search');

// Module-level runner keeps the cache and rate limit across warm invocations.
const runLiveSearch = createAmazonSearchRunner({
  pythonPath: process.env.PYTHON_PATH || 'python3',
  scriptPath: path.join(__dirname, '..', 'scraper', 'amazon_paapi.py')
});

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET requests only.' });
    return;
  }
  const { statusCode, payload } = await handleDealsRequest(req.query || {}, { runLiveSearch });
  res.status(statusCode).json(payload);
};
