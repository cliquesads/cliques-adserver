/* jshint node: true */
'use strict';

//first-party packages
const logger = require('./lib/logger');
const connections = require('./lib/connections');
const express = require('./lib/express');
const USER_CONNECTION = connections.USER_CONNECTION;
const EXCHANGE_CONNECTION = connections.EXCHANGE_CONNECTION;

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

const app = express(USER_CONNECTION);

const router = require('./lib/router')(EXCHANGE_CONNECTION, logger, httpConfig);
app.use('/', router);