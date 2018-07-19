var cliques_node_utils = require('@cliques/cliques-node-utils');
var logging = cliques_node_utils.logging;
var config = require('config');
var util = require('util');
var uuid = require('node-uuid');
var lib_request = require('request');
var pmx = require('pmx');
var CLIQUESBOT_UA_STRING = config.get('Screenshots.userAgent');

/**
 * AdServer-specific CLogger subclass...which itself is a subclass of winston.logger
 *
 * @param options winston logger options object
 * @constructor
 */
function AdServerCLogger(options){
    logging.CLogger.call(this, options);
}
util.inherits(AdServerCLogger, logging.CLogger);


/**
 * Impression logger
 *
 * @param request
 * @param response
 * @param impURL
 * @param creative_group
 * @param creative
 */
AdServerCLogger.prototype.impression = function(request, response, impURL, creative_group, creative){
    // filter out CliquesBot (screenshot crawler) imps
    if (request.headers['user-agent'] != CLIQUESBOT_UA_STRING) {
        var imp_meta = {
            type: 'IMPRESSION',
            uuid: request.uuid,
            creative: creative.id,
            creativegroup: creative_group.id,
            campaign: creative_group.parent_campaign.id,
            advertiser: creative_group.parent_advertiser.id,
            adv_clique: creative_group.parent_campaign.clique,
            placement: impURL.pid,
            impid: impURL.impid
        };
        this.info('Impression', imp_meta);
    }
};

/**
 * Click logger
 *
 * @param request
 * @param response
 * @param click_url
 * @param bidder
 */
AdServerCLogger.prototype.click = function(request, response, click_url, bidder){
    var self = this;
    if (request.headers['user-agent'] !== CLIQUESBOT_UA_STRING) {
        var click_meta = {
            type: 'CLICK',
            uuid: request.uuid,
            clickid: click_url.clickid,
            creative: click_url.cid,
            campaign: click_url.campid,
            creativegroup: click_url.crgid,
            advertiser: click_url.advid,
            placement: click_url.pid,
            redir: click_url.redir,
            impid: click_url.impid
        };
        this.info('Click', click_meta);

        // Now form & send click event POST request to bidder
        if (bidder){
            var req_body = {
                type: 'CLICK',
                timestamp: new Date() / 1000,
                bidRequestId: click_url.bidid,
                impid: click_url.impid,
                userIds: [click_meta.uuid]
            };

            var DEFAULT_HEADERS = {
                "Content-Type": "application/json",
                "x-openrtb-version": config.get('Exchange.openrtb.version')
            };
            var request_options = {
                "url": bidder.clickurl,
                "headers": DEFAULT_HEADERS,
                "body": req_body,
                "json": true
            };

            lib_request.post(request_options,function(err, response, body){
                if (err) {
                    self.error('Click event error: ' + err);
                    return;
                }
                self.info('Click event sent to bidder for clickId ' + click_meta.clickid + ', bidId '
                    + click_url.bidid +  '. RESPONSE_CODE: ' + response.statusCode);
            });
        } else {
            self.error("ERROR: No bidder found for clickId " + click_meta.clickid + ", bidId " + click_url.bidid
                + ", can't send event to bidder.");
        }

    }
};

/**
 * Action logger
 *
 * @param request
 * @param response
 * @param act_url
 */
AdServerCLogger.prototype.action = function(request, response, act_url){
    if (request.headers['user-agent'] !== CLIQUESBOT_UA_STRING) {
        var conv_meta = {
            type: 'ACTION',
            uuid: request.uuid,
            actionid: uuid.v4(),
            actionbeacon: act_url.abid,
            advertiser: act_url.advid,
            value: act_url.value
        };
        this.info('Action', conv_meta)
    }
};

/**
 * Log server-to-server calls
 *
 * @param eventType 'impression', 'click' or 'action'
 * @param url
 * @param method
 * @param retries
 * @param err
 * @param response
 */
AdServerCLogger.prototype.s2s = function(eventType, url, method, retries, err, response){
    var conv_meta = {
        type: 'S2S',
        eventType: eventType,
        method: method,
        url: url,
        responseStatusCode: response.statusCode,
        retries: retries,
    };
    if (err) {
        conv_meta.responseMessage = err;
        this.error('s2s ERROR', conv_meta);
        // also emit pmx event to send custom event to KeyMetrics
        pmx.emit('s2s:error', {
            eventType : eventType,
            statusCode: response.statusCode,
            msg: err,
        });
    } else {
        conv_meta.responseMessage = 'OK';
        this.info('s2s', conv_meta);
    }
};

exports.AdServerCLogger = AdServerCLogger;