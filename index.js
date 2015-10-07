//first-party packages
var node_utils = require('cliques_node_utils');
var cliques_cookies = node_utils.cookies;
var logging = require('./lib/adserver_logging');
var urls = node_utils.urls;
var db = node_utils.mongodb;
var bigQueryUtils = node_utils.google.bigQueryUtils;
var googleAuth = node_utils.google.auth;

//third-party packages
//have to require PMX before express to enable monitoring
var pmx = require('pmx').init();
var express = require('express');
var https = require('https');
var http = require('http');
var app = express();
var fs = require('fs');
var jade = require('jade');
var requestIp = require('request-ip');
var winston = require('winston');
var path = require('path');
var util = require('util');
var cookieParser = require('cookie-parser');
var responseTime = require('response-time');
var config = require('config');

/* -------------------  NOTES ------------------- */

//TODO: invocation-placements (client-side shit),

/* -------------------  LOGGING ------------------- */

var logfile = path.join(
    process.env['HOME'],
    'data',
    'logs',
    util.format('adserver_%s.log',node_utils.dates.isoFormatUTCNow())
);

var chunkSize = config.get('AdServer.redis_event_cache.chunkSize');
var devNullLogger = logger = new logging.AdServerCLogger({transports: []});
if (process.env.NODE_ENV != 'test'){
    var bq_config = bigQueryUtils.loadFullBigQueryConfig('./bq_config.json');
    var eventStreamer = new bigQueryUtils.BigQueryEventStreamer(bq_config,
        googleAuth.DEFAULT_JWT_SECRETS_FILE,chunkSize);
    logger = new logging.AdServerCLogger({
        transports: [
            new (winston.transports.Console)({timestamp:true}),
            new (winston.transports.File)({filename:logfile,timestamp:true}),
            new (winston.transports.RedisEventCache)({ eventStreamer: eventStreamer})
        ]
    });
} else {
    // just for running unittests so whole HTTP log isn't written to console
    logger = devNullLogger;
}

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
var EXCHANGE_CONNECTION = db.createConnectionWrapper(exchangeMongoURI, exchangeMongoOptions, function(err, logstring){
    if (err) throw err;
    logger.info(logstring);
});
var advertiser_models = new db.models.AdvertiserModels(EXCHANGE_CONNECTION);

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
var USER_CONNECTION = db.createConnectionWrapper(userMongoURI, userMongoOptions, function(err, logstring){
    if (err) throw err;
    logger.info(logstring);
});

/* ------------------- HOSTNAME VARIABLES ------------------- */

// http_hostname var is external http_hostname, not localhost
var http_hostname = config.get('AdServer.http.external.hostname');
var https_hostname = config.get('AdServer.https.external.hostname');
var http_port = config.get('AdServer.http.external.port');
var https_port = config.get('AdServer.https.external.port');

/* ------------------- EXPRESS MIDDLEWARE ------------------- */

// inside request-ip middleware handler
app.use(function(req, res, next) {
    req.clientIp = requestIp.getClientIp(req); // on localhost > 127.0.0.1
    next();
});
app.use(cookieParser());
app.use(responseTime());
app.set('http_port', (config.get('AdServer.http.port') || 5000));
app.set('https_port', (config.get('AdServer.https.port') || 3000));
app.use(express.static(__dirname + '/public'));

// custom cookie-parsing middleware
var days_expiration = config.get('Cookies.expirationdays');
var domain = config.get('Cookies.domain');
var cookie_handler = new cliques_cookies.CookieHandler(days_expiration,domain,USER_CONNECTION);
app.use(function(req, res, next){
    cookie_handler.get_or_set_uuid(req, res, next);
});

// custom HTTP request logging middleware
app.use(function(req, res, next){
    logger.httpRequestMiddleware(req, res, next);
});

/*  ------------------- Jade Templates ------------------- */

var img_creative_iframe  = jade.compileFile('./templates/img_creative_iframe.jade', null);
var doubleclick_javascript  = jade.compileFile('./templates/doubleclick_javascript.jade', null);

/*  ------------------- HTTP Endpoints  ------------------- */

http.createServer(app).listen(app.get('http_port'));
https.createServer({
    key: fs.readFileSync('./config/cert/star_cliquesads_com.key'),
    cert: fs.readFileSync('./config/cert/star_cliquesads_com.crt'),
    ca: fs.readFileSync('./config/cert/DigiCertCA.crt')
}, app).listen(app.get('https_port'));

app.get('/', function(request, response) {
    response.status(200).send();
});

/**
 * Serves ad from iFrame call
 *
 * Expects following query args:
 * - crgid : creative group ID
 * - pid : placement ID
 * - impid : impression ID
 */
app.get(urls.IMP_PATH, function(request, response){
    if (!request.query.hasOwnProperty('crgid')){
        response.status(404).send("ERROR 404: Creative not found - no ID Parameter provided");
        logger.error('GET Request sent to /crg without a creative_group_id');
        return;
    }

    //TODO: Remove port once in prod
    var secure = (request.protocol == 'https');
    var port = secure ? https_port: http_port;
    var impURL = new urls.ImpURL(http_hostname, https_hostname, port);
    impURL.parse(request.query, secure);

    //Temporary function to handle switching between doubleclick & internal click URLs
    function getRedir(creative){
        if (creative.type === 'doubleclick'){
            // This only works because DFA ads append click URL directly to the end
            // of the third-party provided click URL
            return '';
        } else {
            return creative.click_url;
        }
    }

    // make the db call to get creative group details
    advertiser_models.getNestedObjectById(impURL.crgid, 'CreativeGroup', function(err, obj){
        if (err) {
            logger.error('Error trying to query creativeGroup from DB: ' + err);
            response.status(500).send('Something went wrong');
            return;
        }
        var creative = obj.getWeightedRandomCreative();
        var clickURL = new urls.ClickURL(http_hostname, https_hostname, port);
        clickURL.format({
            cid: creative.id,
            advid: obj.parent_advertiser.id,
            crgid: obj.id,
            campid: obj.parent_campaign.id,
            pid: impURL.pid,
            impid: impURL.impid,
            redir: getRedir(creative)
        }, impURL.secure);

        if (creative.type === 'doubleclick'){
            // TODO: Make this more robust, this is terrible
            var tag = urls.expandURLMacros(creative.tag, {
                cachebuster: Date.now().toString(),
                click_url: clickURL.url
            });
            var html = doubleclick_javascript({
                doubleclick_tag: tag
            });
        } else {
            html = img_creative_iframe({
                click_url: clickURL.url,
                img_url: creative.url,
                width: creative.w,
                height: creative.h
            });
        }
        response.send(html);
        logger.httpResponse(response);
        logger.impression(request, response, impURL, obj, creative);
    });
});

/**
 * Endpoint to handle clicks.  Redirects to whatever URL is specified in the 'redir' query param.
 *
 */
app.get(urls.CLICK_PATH, function(request, response){
    // first check if incoming request has necessary query params
    if (!request.query.hasOwnProperty('redir')){
        response.status(404).send("ERROR 404: No redirect url specified");
        logger.error('GET Request sent to click path with no placement_id');
        return;
    }
    //TODO: Remove port once in prod
    var secure = (request.protocol == 'https');
    var port = secure ? https_port: http_port;
    var clickURL = new urls.ClickURL(http_hostname, https_hostname, port);
    clickURL.parse(request.query, secure);
    response.status(302).set('location', clickURL.redir);
    response.send();
    logger.httpResponse(response);
    logger.click(request, response, clickURL);
});

/**
 * Endpoint to handle conversions (actions)
 */
app.get(urls.ACTION_PATH, function(request, response){
    var secure = (request.protocol == 'https');
    var port = secure ? https_port: http_port;
    var actURL = new urls.ActionBeaconURL(http_hostname, https_hostname, port);
    actURL.parse(request.query, secure);
    response.status(200).send();
    logger.action(request, response, actURL);
});