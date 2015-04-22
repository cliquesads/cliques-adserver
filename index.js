//first-party packages
var node_utils = require('cliques_node_utils');
var cliques_cookies = node_utils.cookies;
var logging = require('./lib/adserver_logging');
var urls = require('./lib/urls');
var db = node_utils.mongodb;
var bigQueryUtils = node_utils.google.bigQueryUtils;
var googleAuth = node_utils.google.auth;

//third-party packages
//have to require PMX before express to enable monitoring
var express = require('express');
var app = express();
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
    'logs',
    util.format('adserver_%s.log',node_utils.dates.isoFormatUTCNow())
);

var devNullLogger = logger = new logging.AdServerCLogger({transports: []});
if (process.env.NODE_ENV != 'test'){
    var bq_config = bigQueryUtils.loadFullBigQueryConfig('./bq_config.json');
    var eventStreamer = new bigQueryUtils.BigQueryEventStreamer(bq_config,
        googleAuth.DEFAULT_JWT_SECRETS_FILE,20);
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

/* ------------------- EXPRESS MIDDLEWARE ------------------- */

// inside request-ip middleware handler
app.use(function(req, res, next) {
    req.clientIp = requestIp.getClientIp(req); // on localhost > 127.0.0.1
    next();
});
app.use(cookieParser());
app.use(responseTime());
app.set('port', (config.get('AdServer.http.port') || 5000));
app.use(express.static(__dirname + '/public'));

// custom cookie-parsing middleware
var cookie_handler = new cliques_cookies.CookieHandler(config.get('Exchange.cookies.expirationdays'),USER_CONNECTION);
app.use(function(req, res, next){
    cookie_handler.get_or_set_uuid(req, res, next);
});

// custom HTTP request logging middleware
app.use(function(req, res, next){
    logger.httpRequestMiddleware(req, res, next);
});

/*  ------------------- Jade Templates ------------------- */

var img_creative_iframe  = jade.compileFile('./templates/img_creative_iframe.jade', null);

/*  ------------------- HTTP Endpoints  ------------------- */

app.listen(app.get('port'), function(){
    logger.info("Cliques AdServer is running at localhost:" + app.get('port'));
});

app.get('/', function(request, response) {
    response.send('nothing to see here');
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
    // make the db call to get creative group details
    var impURL = new urls.ImpURL();
    var secure = (request.protocol == 'https');
    impURL.parse(request.query, secure);

    advertiser_models.getNestedObjectById(request.query.crgid, 'CreativeGroup', function(err, obj){
        if (err) {
            logger.error('Error trying to query creativeGroup from DB: ' + err);
            response.status(500).send('Something went wrong');
            return;
        }
        var creative = obj.getWeightedRandomCreative();
        var clickURL = new urls.ClickURL();
        clickURL.format({
            cid: creative.id,
            pid: impURL.pid,
            redir: creative.click_url
        }, impURL.secure);

        var html = img_creative_iframe({
            click_url: clickURL.url,
            img_url: creative.url,
            width: creative.w,
            height: creative.h
        });
        response.send(html);

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
    var clickURL = new urls.ClickURL();
    var secure = (request.protocol == 'https');
    clickURL.parse(request.query, secure);
    response.status(302).set('location', clickURL.redir);
    response.send();
    logger.click(request, response, clickURL);
});

app.get('/conv', function(request, response){

});