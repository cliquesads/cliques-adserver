//first-party packages
var node_utils = require('@cliques/cliques-node-utils');
var logging = require('./adserver_logging');
var bigQueryUtils = node_utils.google.bigQueryUtils;
var googleAuth = node_utils.google.auth;

//third-party packages
//have to require PMX before express to enable monitoring
var winston = require('winston');
var path = require('path');
var util = require('util');
var config = require('config');

var logfile = path.join(
    process.env['HOME'],
    'data',
    'logs',
    util.format('adserver_%s.log',node_utils.dates.isoFormatUTCNow())
);

// Set number of records to keep in Redis event-type cache at any given time
var chunkSize = config.get('AdServer.logger.redis_event_cache.chunkSize');

// Fake logger just for testing
var devNullLogger = logger = new logging.AdServerCLogger({transports: []});

if (process.env.NODE_ENV !== 'test'){
    // set up production logger
    const adEventDataset = config.get("AdServer.logger.bigQuery.adEventDataset");
    const httpEventDataset = config.get("AdServer.logger.bigQuery.httpEventDataset");
    var bq_config = bigQueryUtils.loadFullBigQueryConfig('./bq_config.json', httpEventDataset, adEventDataset);

    // Init eventStreamer, thing that binds to cache and sends chunks to BQ
    var eventStreamer = new bigQueryUtils.BigQueryEventStreamer(bq_config,
        googleAuth.DEFAULT_JWT_SECRETS_FILE,chunkSize);
    // Init logger
    logger = new logging.AdServerCLogger({
        transports: [
            new (winston.transports.Console)({timestamp:true}),
            new (winston.transports.File)({ filename:logfile, timestamp:true, maxsize: 1073741824, zippedArchive: true }),
            new (winston.transports.RedisEventCache)({ eventStreamer: eventStreamer})
        ]
    });
} else {
    // just for running unittests so whole HTTP log isn't written to console
    logger = devNullLogger;
}

module.exports = logger;