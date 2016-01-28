//first-party packages
var node_utils = require('cliques_node_utils');
var logger = require('./lib/logger');
var urls = node_utils.urls;
var db = node_utils.mongodb;
var connections = require('./lib/connections');
var USER_CONNECTION = connections.USER_CONNECTION;
var EXCHANGE_CONNECTION = connections.EXCHANGE_CONNECTION;

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
 * Temporary function to handle switching between doubleclick & internal click URLs
 */
var getRedir = function(creative){
    if (creative.type === 'doubleclick'){
        // This only works because DFA ads append click URL directly to the end
        // of the third-party provided click URL
        return '';
    } else {
        return creative.click_url;
    }
}

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
 * Serves ad from iFrame call
 *
 * Expects following query args:
 * - crgid : creative group ID
 * - pid : placement ID
 * - impid : impression ID
 */
app.get(urls.CR_PATH, function(request, response){
    if (!request.query.hasOwnProperty('cid')){
        response.status(404).send("ERROR 404: Creative not found - no ID Parameter provided");
        logger.error('GET Request sent to /cr without a creative_id');
        return;
    }

    //TODO: Remove port once in prod
    var secure = (request.protocol == 'https');
    var port = secure ? https_port: http_port;
    var crURL = new urls.CreativeURL(http_hostname, https_hostname, port);
    crURL.parse(request.query, secure);

    // make the db call to get creative group details
    advertiser_models.getNestedObjectById( crURL.cid, 'Creative', function(err, creative){
        if (err) {
            logger.error('Error trying to query creativeGroup from DB: ' + err);
            response.status(500).send('Something went wrong');
            return;
        }
        var clickURL = new urls.ClickURL(http_hostname, https_hostname, port);
        clickURL.format({
            cid: creative.id,
            advid: creative.parent_advertiser.id,
            crgid: creative.parent_creativegroup.id,
            campid: creative.parent_campaign.id,
            redir: getRedir(creative)
        },  crURL.secure);

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