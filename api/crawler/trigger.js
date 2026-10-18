'use strict';

module.exports = async (req, res) => {
  res.status(202).json({
    status: 'disabled',
    message:
      'Serverless deployment par background source scan available nahi hai. ' +
      'Abhi demo catalog (sample listings) use ho raha hai; live merchant feeds connect hone par ye page update hoga.'
  });
};
