'use strict';

const { loadDemoDeals } = require('../../search_pipeline');

module.exports = async (req, res) => {
  res.status(200).json({
    status: 'idle',
    serverless: true,
    demo_listings: loadDemoDeals().length,
    message:
      'Serverless deployment: crawler local machine par hi chalta hai. Public site demo catalog (sample listings) dikhata hai.'
  });
};
