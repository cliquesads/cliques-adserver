/* jshint node: true */
'use strict';

var winston = require('winston');
var config = require('config');
var logger = require('./logger');

var node_utils = require('@cliques/cliques-node-utils');
var db = node_utils.mongodb;
var connections = require('./connections');
var SCREENSHOTS_EXCHANGE_CONNECTION = connections.SCREENSHOTS_EXCHANGE_CONNECTION;
var screenshotModels = new db.models.ScreenshotModels(SCREENSHOTS_EXCHANGE_CONNECTION);

/**
 * Given the creativeGroupId and placementId, this function forms the related key to store in redis
 *
 * @param {String} placementId - the placement id
 * @param {String} creativeGroupId - the creative group id
 */
var formIdPairKey = function(placementId, creativeGroupId) {
    return 'pid' + placementId + '-crgId' + creativeGroupId;
};

/**
 * Constructs the initial redis value that contains the current timestamp and counter value for a creativeGroupId/placementId pair
 */
var initiateIdPairValue = function() {
    var timestamp = new Date().getTime();
    return 'count=1&timestamp=' + timestamp;
};

/**
 * Given a value string fetched from redis, this function extracts the counter and timestamp value from the string
 *
 * @param {String} value - the corresponding value of id pair key fetched from redis
 */
var parseIdPairValue = function(value) {
    var count = value.substring(value.indexOf('=') + 1, value.indexOf('&'));
    count = parseInt(count);
    var timestamp = value.substring(value.indexOf('timestamp=') + 'timestamp='.length);
    timestamp = parseInt(timestamp);
    return {
        count: count,
        timestamp: timestamp
    };
};

/**
 * Given a value string fetched from redis, this function increments the counter value from this value then return the updated value string
 *
 * @param {String} originalValue - the original value of id pair key fetched from redis
 */
var getIncrementedCountOfIdPairValue = function(originalValue) {
    var idPairInfo = parseIdPairValue(originalValue);
    idPairInfo.count += 1;
    return 'count='+idPairInfo.count+'&timestamp='+idPairInfo.timestamp;
};

/**
 * With a given placementId/creativeGroupId pair, this function checks if the key pair exists in redis.
 * If it doesn't exist yet, store it in redis with current timestamp and counter value set to 1
 * If it already exists but it hasn't timed out yet, increment its counter
 * If within the given time range, its counter reaches the screenshotLimits, publish a message to notify cliques-screenshot/phantomjs to capture screen;
 * Otherwise if its counter doesn't reach the screenshotLimits within the time range, clear the counter and reset timestamp.
 *
 * @param {String} placementId - placement id
 * @param {String} creativeGroupId - creative group id
 * @param {String} websiteURL - the URL of the website that is serving cliques ad
 * @param {Function} pubSubService - pub/sub service to publish the capture screen message
 */
var storeIdPair = exports.storeIdPair = function(placementId, creativeGroupId, websiteURL, pubsubService) {
    var timeoutSecs = config.get('AdServer.screenshotTimeoutInSec');
    var screenshotLimits = config.get('AdServer.screenshotLimits');

    var redisConnection = winston.transports.GetDefaultRedisClient();
    if (!redisConnection) {
        logger.error('No redis connection');
        return;
    }
    var keyForIdPair = formIdPairKey(placementId, creativeGroupId);
    redisConnection.get(keyForIdPair, function(err, reply) {
        if (err) {
            logger.error(err);
            return;
        }
        if (!reply) {
            // such id pair doesn't exist in redis yet, store it with a timestamp and a counter
            redisConnection.set(keyForIdPair, initiateIdPairValue());
        } else {
            // such id pair already exists, check if exceeded time limits
            var valueInfo = parseIdPairValue(reply);
            var elapsed = new Date().getTime() - valueInfo.timestamp;
            if (elapsed > timeoutSecs * 1000) {
                // time limits exceeded, should reset the counter and timestamp of this id pair value
                redisConnection.set(keyForIdPair, initiateIdPairValue());
            } else {
                if (valueInfo.count >= screenshotLimits) {
                    // reached screenshot limits, reset counter and timestamp for this id pair and publish a message to notify phantomjs to capture screen
                    redisConnection.set(keyForIdPair, initiateIdPairValue());
                    // Depending on whether this is cliques-adserver or smartertravel-adserver,
                    // the screenshotPubSub service should publish message to different topic
                    var repo = config.get('AdServer.google.topic');
                    screenshotModels.Screenshot.findOne({
                        placement: placementId,
                        creativegroup: creativeGroupId
                    }, function(err, screenshotObj) {
                        if (err) {
                            logger.error(err);
                            return;
                        }
                        if (!screenshotObj) {
                            // Publish message to capture this screenshot WHEN no such screenshot has been created recently
                            pubsubService.publishers[repo](creativeGroupId, placementId, websiteURL);
                        } else {
                            // Such screenshot exists already, 
                            // should check if it is expired, if it is, 
                            // we still need to publish message to capture this screenshot
                            var screenshotExpirationHours = config.get('Screenshots.screenshotExpirationHours');
                            var screenshotCreatedTime = new Date(screenshotObj.tstamp);
                            var screenshotExpirationHoursAgo = new Date();
                            screenshotExpirationHoursAgo.setHours(screenshotExpirationHoursAgo.getHours() - screenshotExpirationHours);
                            if (screenshotExpirationHoursAgo >= screenshotCreatedTime) {
                                // Publish message to capture this screenshot WHEN such screenshot has already expired
                                pubsubService.publishers[repo](creativeGroupId, placementId, websiteURL);
                            }
                        }
                    });
                } else {
                    // simply increment the count for this id pair
                    var updatedValue = getIncrementedCountOfIdPairValue(reply);
                    redisConnection.set(keyForIdPair, updatedValue);
                }
            }
        }
    });
};
