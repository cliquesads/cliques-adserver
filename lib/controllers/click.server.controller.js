/* jshint node: true */
'use strict';

const node_utils = require('@cliques/cliques-node-utils'),
    urls = node_utils.urls,
    request = require('request'),
    connections = require('../connections'),
    serverToServer = require('../serverToServer'),
    config = require('config'),
    PRIMARY_EXCHANGE_CONNECTION = connections.PRIMARY_EXCHANGE_CONNECTION;

// Get server-to-server URLs, if there are any.
let serverToServerConfig = serverToServer.getAndValidateS2SConfig('AdServer.serverToServer.onClick');

module.exports = function(db, logger, httpConfig){
    const advertiser_models = new node_utils.mongodb.models.AdvertiserModels(db);
    const cliquesModels = new node_utils.mongodb.models.CliquesModels(PRIMARY_EXCHANGE_CONNECTION);

    // get object w/ all bidder URL's once on load.
    // TODO: Add pm2 signal for this.
    let bidders;
    cliquesModels.getAllBidders(function(err, res){
        if (err) return logger.error('ERROR retrieving bidders from Mongo: ' + err);
        bidders = res;
        logger.info('Got new bidder config: ' + JSON.stringify(bidders));
    });

    return {
        /**
         * Endpoint to handle clicks.  Redirects to whatever URL is specified in the 'redir' query param.
         */
        click: function(req, response){
            // first check if incoming request has necessary query params
            if (!req.query.hasOwnProperty('redir')){
                response.status(404).send("ERROR 404: No redirect url specified");
                logger.error('GET Request sent to click path with no placement_id');
                return;
            }
            //TODO: Remove port once in prod
            const secure = (req.protocol === 'https');
            const port = secure ? httpConfig.httpsPort: httpConfig.httpPort;
            const clickURL = new urls.ClickURL(httpConfig.httpHostname, httpConfig.httpsHostname, port);
            clickURL.parse(req.query, secure);
            response.status(302).set('location', clickURL.redir);
            response.send();

            // send click tracker request asynchronously
            if (clickURL.tracker){
                advertiser_models.getNestedObjectById(clickURL.cid, 'Creative', function(err, creative){
                    if (err){
                        logger.error(`Error trying to query creative from DB to get clickTracker: ${err}`);
                        return;
                    }
                    if (creative.clickTracker){
                        request.get(creative.clickTracker)
                            .on('response', function(response) {
                                logger.info(`3rd-party click tracker request sent to ${creative.clickTracker}. 
                                RESPONSE_CODE: ${response.statusCode}`);
                            });
                    }
                });
            }
            logger.httpResponse(response);

            // fire off server-to-server request, if there is one
            if (serverToServerConfig){
                serverToServer.sendRequest('click', serverToServerConfig, clickURL.external, logger);
            }

            // now find which bidder to send click event to, which will be the bidder corresponding to the
            // campaign's Clique.
            // TODO: Don't like having to make a DB call for each click. Can probably either add clique_id
            // TODO: or cache campaign data in Redis in the future to make this faster.
            advertiser_models.getNestedObjectById(clickURL.campid, 'Campaign', function(err, campaign) {
                if (err){
                    logger.error(`Error trying to query campaign from DB to get campaign clique: ${err}`);
                    return;
                }
                const eligible_bidders = bidders.filter(function(clique){
                    return clique._id = campaign.clique;
                });
                const bidder = eligible_bidders.length ? eligible_bidders[0].bidder : false;
                logger.click(req, response, clickURL, bidder);
            });
        }
    };
};
