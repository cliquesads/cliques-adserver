/* jshint node: true */
'use strict';

//first-party packages
const logger = require('./lib/logger');
const connections = require('./lib/connections');
const express = require('./lib/express');
const pmx = require('pmx');
const USER_CONNECTION = connections.USER_CONNECTION;
const EXCHANGE_CONNECTION = connections.EXCHANGE_CONNECTION;
const PRIMARY_EXCHANGE_CONNECTION = connections.PRIMARY_EXCHANGE_CONNECTION;

//third-party packages
const config = require('config');

/* ------------- ADSERVER HOSTNAME & PORT VARIABLES ------------ */

// HTTP_HOSTNAME var is external HTTP_HOSTNAME, not localhost
const httpConfig = {
    httpHostname: config.get('AdServer.http.external.hostname'),
    httpsHostname: config.get('AdServer.https.external.hostname'),
    httpPort: config.get('AdServer.http.external.port'),
    httpsPort: config.get('AdServer.https.external.port')
};

/* -------------------- CONFIGURE EXPRESS --------------------- */

const winston = require('winston');
const REDIS_CONNECTION = winston.transports.GetDefaultRedisClient();
const fraudDetection = require('@cliques/cliques-node-utils').fraudDetection;
const fraudDetector = new fraudDetection.FraudDetector(PRIMARY_EXCHANGE_CONNECTION, REDIS_CONNECTION, logger);
const app = express(USER_CONNECTION, fraudDetector);

const router = require('./lib/router')(EXCHANGE_CONNECTION, logger, httpConfig);
app.use('/', router);

/* ------------------- PM2 ACTIONS --------------------- */

pmx.action('updateIPBlockList', function(reply){
    fraudDetector.updateBlockedIPsInRedis().then(res=>{
        const s = `FraudDetector: MongoDB BlockedIP collection successfully stored to redis: ${res}`;
        reply({success: true, response: s });
        logger.info(s);
    }).catch((err) => {
        const s = `FraudDetector ERROR: MongoDB BlockedIP collection not stored to redis: ${err}`;
        reply({success: false, response: s });
        logger.error(s);
    });
});

pmx.action('updateUserAgentBlockList', function(reply){
    fraudDetector.updateBlockedUserAgentsInRedis().then(res=>{
        const s = `FraudDetector: MongoDB BlockedUserAgent collection successfully stored to redis: ${res}`;
        reply({success: true, response: s });
        logger.info(s);
    }).catch((err) => {
        const s = `FraudDetector ERROR: MongoDB BlockedUserAgent collection not stored to redis: ${err}`;
        reply({success: false, response: s });
        logger.error(s);
    });
});