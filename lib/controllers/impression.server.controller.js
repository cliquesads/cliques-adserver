/* jshint node: true */
'use strict';

const creativeLookup = require('../creativeLookerUpper'),
    pug = require('pug'),
    node_utils = require('@cliques/cliques-node-utils'),
    ScreenshotPubSub = node_utils.google.pubsub.ScreenshotPubSub,
    config = require('config'),
    serverToServer = require('../serverToServer'),
    urls = node_utils.urls;

/* ----------------- Screenshot PubSub controller and service instance ----------------- */
const screenshotPublisherController = require('../screenshotPublisherController');
let pubsub_options;
if (process.env.NODE_ENV !== 'production'){
    pubsub_options = {
        projectId: 'mimetic-codex-781',
        test: true
    };
} else {
    pubsub_options = {projectId: 'mimetic-codex-781'};
}
const service = new ScreenshotPubSub(pubsub_options);

/*  ------------------- Jade Templates ------------------- */

const img_creative_iframe  = pug.compileFile('./templates/img_creative_iframe.pug', null);
const doubleclick_javascript  = pug.compileFile('./templates/doubleclick_javascript.pug', null);

// Get server-to-server URLs, if there are any.
let serverToServerConfig = serverToServer.getAndValidateS2SConfig('AdServer.serverToServer.onImpression');

module.exports = function(db, logger, httpConfig){
    const advertiser_models = new node_utils.mongodb.models.AdvertiserModels(db);
    const publisher_models = new node_utils.mongodb.models.PublisherModels(db);

    /**
     * Utility function to handle bulk of the legwork in rendering a creative tag with proper vars.
     *
     * @param creative - any object conforming to creativeSchema
     * @param secure - render as secure tag or non-secure
     * @param [clickParams] - optional object containing extra params to format clickURL with
     * @param callback
     */
    function renderCreativePayload(creative, secure, clickParams, callback){
        clickParams = clickParams || {};
        if (!callback){
            callback = clickParams;
            clickParams = {};
        }
        const port = secure ? httpConfig.httpsPort: httpConfig.httpPort;
        // Generate Cliques click URL
        const clickURL = new urls.ClickURL(httpConfig.httpHostname, httpConfig.httpsHostname, port);

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
        let payload;
        // generate JSON of native assets & template to return to tag if native
        if (creative.type === 'native'){
            // just send whole native schema for now
            payload = creative.getNativeAssets(clickURL);
        } else {
            // Otherwise, generate iFrame of display tag
            if (creative.hostingType === 'doubleclick'){
                // TODO: Make this more robust, this is terrible
                const tag = urls.expandURLMacros(creative.tag, {
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
    }

    return {
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
        creativegroup: function(request, response){
                if (!request.query.hasOwnProperty('crgid')){
                    response.status(404).send("ERROR 404: Creative not found - no ID Parameter provided");
                    logger.error('GET Request sent to /crg without a creative_group_id');
                    return;
                }
                const secure = (request.protocol === 'https');
                const port = secure ? httpConfig.httpsPort: httpConfig.httpPort;
                const impURL = new urls.ImpURL(httpConfig.httpHostname, httpConfig.httpsHostname, port);
                impURL.parse(request.query, secure);

                // make the db call to get creative group details
                advertiser_models.getNestedObjectById(impURL.crgid, 'CreativeGroup', function(err, obj){
                    if (err) {
                        logger.error(`Error trying to query creativeGroup from DB: ${err}`);
                        response.status(500).send('Something went wrong');
                        return;
                    }
                    creativeLookup.getCreative(impURL.aid, obj, function(err, creative){
                        // Stuff parent entities into creative to populate click URL macros
                        if (err) return logger.error(err);

                        creative.parent_advertiser = obj.parent_advertiser;
                        creative.parent_creativegroup = obj;
                        creative.parent_campaign = obj.parent_campaign;

                        const clickParams = Object.assign({
                            pid: impURL.pid,
                            impid: impURL.impid,
                            bidid: impURL.bidid,
                            clickid: impURL.clickid
                        }, impURL.external);


                        renderCreativePayload(creative, secure, clickParams, function(err, html){
                            response.send(html);

                            // handle logging & screenshot stuff after returning markup
                            const referrerUrl = impURL.ref;
                            if (referrerUrl){
                                screenshotPublisherController.storeIdPair(impURL.pid, impURL.crgid, referrerUrl, service);
                            }
                            logger.httpResponse(response);
                            logger.impression(request, response, impURL, obj, creative);
                            // fire off server-to-server request, if there is one
                            if (serverToServerConfig){
                                serverToServer.sendRequest('impression', serverToServerConfig, impURL.external, logger);
                            }
                        });
                    });
                });
        },

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
        creative: function(request, response){
            if (!request.query.hasOwnProperty('cid')){
                response.status(404).send("ERROR 404: Creative not found - no ID Parameter provided");
                logger.error('GET Request sent to /cr without a creative_id');
                return;
            }
            const secure = (request.protocol === 'https');
            const port = secure ? httpConfig.httpsPort: httpConfig.httpPort;
            const crURL = new urls.CreativeURL(httpConfig.httpHostname, httpConfig.httpsHostname, port);
            crURL.parse(request.query, secure);

            // make the db call to get creative group details
            advertiser_models.getNestedObjectById( crURL.cid, 'Creative', function(err, creative){
                if (err) {
                    logger.error(`Error trying to query creativeGroup from DB: ${err}`);
                    response.status(500).send('Something went wrong');
                    return;
                }
                renderCreativePayload(creative, secure, function(err, html){
                    response.send(html);
                    logger.httpResponse(response);
                });
            });
        },

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
        pubCreative: function(request, response){
            if (!request.query.hasOwnProperty('pid')){
                response.status(404).send("ERROR 404: Placement not found - no ID Parameter provided");
                logger.error('GET Request sent to /pubcr without a placement_id');
                return;
            }
            const secure = (request.protocol === 'https');
            const port = secure ? httpConfig.httpsPort: httpConfig.httpPort;
            const crURL = new urls.PubCreativeURL(httpConfig.httpHostname, httpConfig.httpsHostname, port);
            crURL.parse(request.query, secure);

            // make the db call to get creative group details
            publisher_models.getNestedObjectById( crURL.pid, 'Placement', function(err, placement){
                if (err) {
                    logger.error(`Error trying to query creativeGroup from DB: ${err}`);
                    response.status(500).send('Something went wrong');
                    return;
                }
                const creative = placement.getRandomHostedCreative();
                if (creative){
                    const clickParams = { pid: placement.id };
                    renderCreativePayload(creative, secure, clickParams, function(err, html){
                        response.send(html);
                        logger.httpResponse(response);
                    });
                } else {
                    response.status(404).send(`ERROR: The requested placement (_id  ${placement._id} 
                        has no hostedCreatives.`);
                    logger.error(`GET Request sent to /pubcr for placement ${placement._id} 
                        but placement has no hostedCreatives!`);
                }
            });
        }
    };
};