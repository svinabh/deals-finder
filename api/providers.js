'use strict';

const { buildProvidersResponse } = require('../search_pipeline');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET requests only.' });
    return;
  }
  const pin = req.query && req.query.pin !== undefined ? req.query.pin : null;
  const { statusCode, payload } = buildProvidersResponse({
    pincode: pin === null ? null : String(pin).trim()
  });
  res.status(statusCode).json(payload);
};
