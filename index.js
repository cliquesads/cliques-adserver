/* jshint node: true */
'use strict';

//first-party packages
var node_utils = require('@cliques/cliques-node-utils'),
    ScreenshotPubSub = node_utils.google.pubsub.ScreenshotPubSub;
var logger = require('./lib/logger');
var urls = node_utils.urls;
var request = require('request');
var tags = node_utils.tags;
var db = node_utils.mongodb;
var connections = require('./lib/connections');
var USER_CONNECTION = connections.USER_CONNECTION;
var EXCHANGE_CONNECTION = connections.EXCHANGE_CONNECTION;

/* ----------------- Screenshot PubSub controller and service instance ----------------- */
var screenshotPublisherController = require('./lib/screenshotPublisherController');
if (process.env.NODE_ENV !== 'production'){
    var pubsub_options = {
        projectId: 'mimetic-codex-781',
        test: true
    };
} else {
    pubsub_options = {projectId: 'mimetic-codex-781'};
}
var service = new ScreenshotPubSub(pubsub_options);

//third-party packages
//have to require PMX before express to enable monitoring
var express = require('./lib/express');
var jade = require('jade');
var config = require('config');

/* ------------------- HOSTNAME VARIABLES ------------------- */

// HTTP_HOSTNAME var is external HTTP_HOSTNAME, not localhost
var HTTP_HOSTNAME = config.get('AdServer.http.external.hostname');
var HTTPS_HOSTNAME = config.get('AdServer.https.external.hostname');
var HTTP_PORT = config.get('AdServer.http.external.port');
var HTTPS_PORT = config.get('AdServer.https.external.port');

/*  ------------------- Jade Templates ------------------- */

var img_creative_iframe  = jade.compileFile('./templates/img_creative_iframe.jade', null);
var doubleclick_javascript  = jade.compileFile('./templates/doubleclick_javascript.jade', null);

/*  ------------------ MongoDB Model Sets ------------------- */

var advertiser_models = new db.models.AdvertiserModels(EXCHANGE_CONNECTION);
var publisher_models = new db.models.PublisherModels(EXCHANGE_CONNECTION);


/*  ------------------------- UTILS ----------------------------- */

/**
 * Utility function to handle bulk of the legwork in rendering a creative tag with proper vars.
 *
 * @param creative - any object conforming to creativeSchema
 * @param secure - render as secure tag or non-secure
 * @param [clickParams] - optional object containing extra params to format clickURL with
 * @param callback
 */
var renderCreativePayload = function(creative, secure, clickParams, callback){
    clickParams = clickParams || {};
    if (!callback){
        callback = clickParams;
        clickParams = {};
    }
    var port = secure ? HTTPS_PORT: HTTP_PORT;
    // Generate Cliques click URL
    var clickURL = new urls.ClickURL(HTTP_HOSTNAME, HTTPS_HOSTNAME, port);

    // Parse Click URL param values from creative & clickParams properties.
    clickParams.cid = creative.id;
    clickParams.redir = creative.getRedir();
    // If creative is an Advertiser tree creative, populate all parent Advertiser entity id params
    if (creative.parent_advertiser){
        clickParams.advid = creative.parent_advertiser.id;
        clickParams.crgid = creative.parent_creativegroup.id;
        clickParams.campid = creative.parent_campaign.id;
    }
    if (creative.clickTracker){
        clickParams.tracker = true;
    }
    clickURL.format(clickParams, secure);

    // Now generate tag HTML or JSON
    var payload;
    // generate JSON of native assets & template to return to tag if native
    if (creative.type === 'native'){
        // just send whole native schema for now
        payload = creative.getNativeAssets(clickURL);
    } else {
        // Otherwise, generate iFrame of display tag
        if (creative.hostingType === 'doubleclick'){
            // TODO: Make this more robust, this is terrible
            var tag = urls.expandURLMacros(creative.tag, {
                cachebuster: Date.now().toString(),
                click_url: clickURL.url
            });
            payload = doubleclick_javascript({
                doubleclick_tag: tag
            });
        } else {
            payload = img_creative_iframe({
                click_url: clickURL.url,
                img_url: secure ? creative.secureUrl : creative.url,
                width: creative.w,
                height: creative.h
            });
        }
    }
    return callback(null, payload);
};

/*  ------------------- HTTP Endpoints  ------------------- */

var app = express(USER_CONNECTION);

app.get('/', function(request, response) {
    response.status(200).send('Cliques AdServer');
});

/* --------------------------------------------------------- */
/* ----------------- IMPRESSION Endpoints ------------------ */
/* --------------------------------------------------------- */

/**
 * Serves ad from iFrame call given a creativegroup ID.
 *
 * Selects a "weighted random" creative from given creative group
 * and serves it.
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
    var secure = (request.protocol == 'https');
    var port = secure ? HTTPS_PORT: HTTP_PORT;
    var impURL = new urls.ImpURL(HTTP_HOSTNAME, HTTPS_HOSTNAME, port);
    impURL.parse(request.query, secure);

    // make the db call to get creative group details
    advertiser_models.getNestedObjectById(impURL.crgid, 'CreativeGroup', function(err, obj){
        if (err) {
            logger.error('Error trying to query creativeGroup from DB: ' + err);
            response.status(500).send('Something went wrong');
            return;
        }
        var creative = obj.getWeightedRandomCreative();
        // Stuff parent entities into creative to populate click URL macros
        creative.parent_advertiser = obj.parent_advertiser;
        creative.parent_creativegroup = obj;
        creative.parent_campaign = obj.parent_campaign;

        var clickParams = {
            pid: impURL.pid,
            impid: impURL.impid
        };
        renderCreativePayload(creative, secure, clickParams, function(err, html){
            response.send(html);
            // handle logging & screenshot stuff after returning markup
            var referrerUrl = impURL.ref;
            if (referrerUrl){
                screenshotPublisherController.storeIdPair(impURL.pid, impURL.crgid, referrerUrl, service);
            }
            logger.httpResponse(response);
            logger.impression(request, response, impURL, obj, creative);
        });
    });
});

/**
 * Serves ad from iFrame call given an advertiser creativeID.
 *
 * This path handles requests for creative using creative ID, rather than creative Group.
 *
 * Expects following query args:
 * - crid : creative group ID
 * - pid : placement ID
 * - impid : impression ID
 */
app.get(urls.CR_PATH, function(request, response){
    if (!request.query.hasOwnProperty('cid')){
        response.status(404).send("ERROR 404: Creative not found - no ID Parameter provided");
        logger.error('GET Request sent to /cr without a creative_id');
        return;
    }
    var secure = (request.protocol == 'https');
    var port = secure ? HTTPS_PORT: HTTP_PORT;
    var crURL = new urls.CreativeURL(HTTP_HOSTNAME, HTTPS_HOSTNAME, port);
    crURL.parse(request.query, secure);

    // make the db call to get creative group details
    advertiser_models.getNestedObjectById( crURL.cid, 'Creative', function(err, creative){
        if (err) {
            logger.error('Error trying to query creativeGroup from DB: ' + err);
            response.status(500).send('Something went wrong');
            return;
        }
        renderCreativePayload(creative, secure, function(err, html){
            response.send(html);
            logger.httpResponse(response);
        });
    });
});

/**
 * Serves ad from iFrame call given a PUBLISHER creativeID, i.e. for default creatives.
 *
 * This path handles requests for creative using creative ID, rather than creative Group.
 *
 * Expects following query args:
 * - pid : creative group ID
 * - pid : placement ID
 * - impid : impression ID
 */
app.get(urls.PUBCR_PATH, function(request, response){
    if (!request.query.hasOwnProperty('pid')){
        response.status(404).send("ERROR 404: Placement not found - no ID Parameter provided");
        logger.error('GET Request sent to /pubcr without a placement_id');
        return;
    }
    var secure = (request.protocol == 'https');
    var port = secure ? HTTPS_PORT: HTTP_PORT;
    var crURL = new urls.PubCreativeURL(HTTP_HOSTNAME, HTTPS_HOSTNAME, port);
    crURL.parse(request.query, secure);

    // make the db call to get creative group details
    publisher_models.getNestedObjectById( crURL.pid, 'Placement', function(err, placement){
        if (err) {
            logger.error('Error trying to query creativeGroup from DB: ' + err);
            response.status(500).send('Something went wrong');
            return;
        }
        var creative = placement.getRandomHostedCreative();
        if (creative){
            var clickParams = { pid: placement.id };
            renderCreativePayload(creative, secure, clickParams, function(err, html){
                response.send(html);
                logger.httpResponse(response);
            });
        } else {
            response.status(404).send("ERROR: The requested placement (_id  " + placement._id + " has no hostedCreatives.");
            logger.error("GET Request sent to /pubcr for placement " + placement._id + ", but placement has no hostedCreatives!");
        }
    });
});


/* --------------------------------------------------------- */
/* ---------------------- CLICK Endpoints ------------------ */
/* --------------------------------------------------------- */

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
    var port = secure ? HTTPS_PORT: HTTP_PORT;
    var clickURL = new urls.ClickURL(HTTP_HOSTNAME, HTTPS_HOSTNAME, port);
    clickURL.parse(request.query, secure);
    response.status(302).set('location', clickURL.redir);
    response.send();
    // send click tracker request asynchronously
    if (clickURL.tracker){
        advertiser_models.getNestedObjectById(clickURL.cid, 'Creative', function(err, creative){
            if (err){
                logger.error('Error trying to query creative from DB to get clickTracker: ' + err);
                return;
            }
            if (creative.clickTracker){
                request.get(creative.clickTracker)
                    .on('response', function(response) {
                        console.log(response.statusCode);
                        console.log(response.headers['content-type']);
                    });
            }
        });
    }
    logger.httpResponse(response);
    logger.click(request, response, clickURL);
});

/* --------------------------------------------------------- */
/* ---------------------- ACTION Endpoints ----------------- */
/* --------------------------------------------------------- */

/**
 * Endpoint to handle conversions (actions)
 */
app.get(urls.ACTION_PATH, function(request, response){
    var secure = (request.protocol == 'https');
    var port = secure ? HTTPS_PORT: HTTP_PORT;
    var actURL = new urls.ActionBeaconURL(HTTP_HOSTNAME, HTTPS_HOSTNAME, port);
    actURL.parse(request.query, secure);
    response.status(200).send();
    logger.action(request, response, actURL);
});

/* --------------------------------------------------------- */
/**
 * CRG Test page, just a placeholder
 */
if (process.env.NODE_ENV !== 'production'){
    app.get('/test_ad', function(request, response){
        var secure = request.protocol === 'https';
        var hostname = secure ? HTTPS_HOSTNAME : HTTP_HOSTNAME;
        var external_port = secure ? HTTPS_PORT : HTTP_PORT;
        var impTag = new tags.ImpTag(hostname, {
            port: external_port,
            secure: secure
        });

        var PLACEMENT_ID = "54f8df2e6bcc85d9653becfb";
        advertiser_models.getNestedObjectById(request.query.crgid, 'CreativeGroup', function(err, obj){
            if (err) {
                logger.error('Error trying to query creativeGroup from DB: ' + err);
                response.status(500).send('Something went wrong');
                return;
            }
            var rendered = impTag.render(obj);
            rendered = urls.expandURLMacros(rendered, { pid: PLACEMENT_ID});
            var fn = jade.compileFile('./templates/test_ad.jade', null);
            var html = fn({ imptag: rendered, pid: PLACEMENT_ID});
            response.send(html);
        });
    });
}