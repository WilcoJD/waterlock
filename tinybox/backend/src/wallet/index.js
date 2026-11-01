'use strict';
const { LocalWallet } = require('./local');
const { OpexWallet } = require('./opex');
const { userOwner } = require('./base');

function createWallet({ db, config, log }) {
  return config.opex.enabled ? new OpexWallet({ db, config, log }) : new LocalWallet({ db, log });
}

module.exports = { createWallet, userOwner };
