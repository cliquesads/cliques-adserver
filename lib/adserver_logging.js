var cliques_node_utils = require('cliques_node_utils');
var logging = cliques_node_utils.logging;
var util = require('util');
var uuid = require('node-uuid');

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
    logger.info('Impression', imp_meta);
};

/**
 * Click logger
 *
 * @param request
 * @param response
 * @param click_url
 */
AdServerCLogger.prototype.click = function(request, response, click_url){
    var click_meta = {
        type: 'CLICK',
        uuid: request.uuid,
        clickid: uuid.v4(),
        creative: click_url.cid,
        placement: click_url.pid,
        redir: click_url.redir
    };
    logger.info('Click', click_meta)
};

/**
 * Conversion logger
 *
 * @param request
 * @param response
 * @param conv_url
 */
AdServerCLogger.prototype.conversion = function(request, response, conv_url){
    var conv_meta = {
        type: 'CONVERSION',
        uuid: request.uuid,
        convid: uuid.v4(),
        tag: conv_url.tagid,
        value: conv_url.value,
        redir: conv_url.advid
    };
    logger.info('Conversion', conv_meta)
};

exports.AdServerCLogger = AdServerCLogger;