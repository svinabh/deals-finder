'use strict';

const { buildStatsResponse, loadDemoDeals } = require('../search_pipeline');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET requests only.' });
    return;
  }
  // The crawled deals.json index is local-only; serverless reports the demo catalog.
  const { statusCode, payload } = buildStatsResponse({ crawledDeals: loadDemoDeals() });
  res.status(statusCode).json(payload);
};
