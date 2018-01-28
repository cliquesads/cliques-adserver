//first-party packages
var node_utils = require('@cliques/cliques-node-utils');
var logger = require('./logger');
var db = node_utils.mongodb;
var util = require('util');
var config = require('config');

/* ------------------- MONGODB - EXCHANGE DB ------------------- */

// Build the connection string
var exchangeMongoURI = util.format('mongodb://%s:%s/%s',
    config.get('AdServer.mongodb.exchange.secondary.host'),
    config.get('AdServer.mongodb.exchange.secondary.port'),
    config.get('AdServer.mongodb.exchange.db'));

var exchangeMongoOptions = {
    user: config.get('AdServer.mongodb.exchange.user'),
    pass: config.get('AdServer.mongodb.exchange.pwd'),
    auth: {authenticationDatabase: config.get('AdServer.mongodb.exchange.db')}
};
exports.EXCHANGE_CONNECTION = db.createConnectionWrapper(exchangeMongoURI, exchangeMongoOptions, function(err, logstring){
    if (err) throw err;
    logger.info(logstring);
});

/* ------------------- MONGODB - USER DB ------------------- */

// Build the connection string
var userMongoURI = util.format('mongodb://%s:%s/%s',
    config.get('AdServer.mongodb.user.primary.host'),
    config.get('AdServer.mongodb.user.primary.port'),
    config.get('AdServer.mongodb.user.db'));

var userMongoOptions = {
    user: config.get('AdServer.mongodb.user.user'),
    pass: config.get('AdServer.mongodb.user.pwd'),
    auth: {authenticationDatabase: config.get('AdServer.mongodb.user.db')}
};
exports.USER_CONNECTION = db.createConnectionWrapper(userMongoURI, userMongoOptions, function(err, logstring){
    if (err) throw err;
    logger.info(logstring);
});

/* ------------------- MONGODB - EXCHANGE DB TO GET BIDDERS ------------------- */

// Build the connection string
var primaryExchangeMongoURI = exports.primaryExchangeMongoURI = util.format('mongodb://%s:%s/%s',
    config.get('Exchange.mongodb.exchange.primary.host'),
    config.get('Exchange.mongodb.exchange.primary.port'),
    config.get('Exchange.mongodb.exchange.db'));
var primaryExchangeMongoOptions = exports.primaryExchangeMongoOptions = {
    user: config.get('Exchange.mongodb.exchange.user'),
    pass: config.get('Exchange.mongodb.exchange.pwd'),
    auth: {authenticationDatabase: config.get('Exchange.mongodb.exchange.db')}
};
exports.PRIMARY_EXCHANGE_CONNECTION = node_utils.mongodb.createConnectionWrapper(primaryExchangeMongoURI, primaryExchangeMongoOptions, function(err, logstring){
    if (err) throw err;
    logger.info(logstring);
});


/* ------------------- MONGODB - SCREENSHOTS EXCHANGE DB ------------------- */

// Build the connection string
var screenshotsExchangeMongoURI = util.format('mongodb://%s:%s/%s',
    config.get('Screenshots.mongodb.exchange.host'),
    config.get('Screenshots.mongodb.exchange.port'),
    config.get('Screenshots.mongodb.exchange.db'));

var screenshotsExchangeMongoOptions = {
    user: config.get('Screenshots.mongodb.exchange.user'),
    pass: config.get('Screenshots.mongodb.exchange.pwd'),
    auth: {authenticationDatabase: config.get('Screenshots.mongodb.exchange.db')}
};
exports.SCREENSHOTS_EXCHANGE_CONNECTION = db.createConnectionWrapper(screenshotsExchangeMongoURI, screenshotsExchangeMongoOptions, function(err, logstring){
    if (err) throw err;
    logger.info(logstring);
});
