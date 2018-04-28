/* jshint node: true */
'use strict';

var winston = require('winston');
var logger = require('./logger');
var config = require('config');
var Redlock = require('redlock');

var EXPIRE_SECONDS = config.get('AdServer.creativeLookup.keyExpireSeconds');
var TTL = config.get('AdServer.creativeLookup.redlock.ttl');

var redisConnection = winston.transports.GetDefaultRedisClient();
if (!redisConnection) {
    return logger.error('CREATIVE LOOKER UPPER: No redis connection');
}

var redlock = new Redlock([redisConnection], {
    // see http://redis.io/topics/distlock
    driftFactor: config.get('AdServer.creativeLookup.redlock.driftFactor'), // time in ms

    // the max number of times Redlock will attempt
    // to lock a resource before erroring
    retryCount:  config.get('AdServer.creativeLookup.redlock.retryCount'),

    // the time in ms between attempts
    retryDelay:  config.get('AdServer.creativeLookup.redlock.retryDelay'), // time in ms

    // the max time in ms randomly added to retries
    // to improve performance under high contention
    // see https://www.awsarchitectureblog.com/2015/03/backoff.html
    retryJitter:  config.get('AdServer.creativeLookup.redlock.retryJitter') // time in ms
});

/**
 * Gets locally-unique creative ID from creativegroup, meaning it gets a unique creative
 * ID for a given auctionId. Uses fast-expiring Redis sets & Redlock (a pessimistic locking
 * implementation for Redis) to store creative ID's that have been served for a given auctionId
 * to avoid duplication.
 *
 * @type {exports.getCreative}
 */
exports.getCreative = function(auctionId, creativegroup, callback){
    // set lock on auctionID key first to ensure creativeIDs get added in sequence to redis,
    // then kick off selection process
    redlock.lock("locks:" + auctionId, TTL).then(function(lock){
        redisConnection.SMEMBERS(auctionId, function(err, creativeIds) {
            if (err) return callback(err);

            // push remaining eligible creatives to weighted creatives array
            const eligibleCreatives = [];
            // array to hold all active creatives in case all creatives have already been served once
            const allActiveCreatives = [];
            creativegroup.creatives.forEach((item) => {
                // filter on active flag
                if (item.active){
                    // & whether or not creative has already been served
                    for (let i = 0; i < item.weight; i++){
                        allActiveCreatives.push(item);
                        // now push to eligible creatives array if it's not in the redis set,
                        // i.e. hasn't been served yet
                        if (creativeIds.indexOf(item.id) === -1) eligibleCreatives.push(item);
                    }
                }
            });

            // it's possible, if there are more impressions sold to a particular campaign
            // than there are creatives in that campaign, that we'll need to get a
            // duplicate creative that's already been served. So check if there are no
            // more eligible creatives left, and just fall back to active creatives weighted
            // array for selection if there aren't
            let creative;
            if (eligibleCreatives.length > 0){
                // select random weighted creative from remaining creatives available
                creative = eligibleCreatives[Math.floor(Math.random()*eligibleCreatives.length)];
            } else {
                // just select creative from all active creatives array in this case
                creative = allActiveCreatives[Math.floor(Math.random()*allActiveCreatives.length)];
            }

            if (!creative){
                return callback(`ERROR: No eligible creatives found for creativegroup ${creativegroup.name} (${creativegroup.id})`)
            } else {
                // add creative ID to redis set so it can't be selected in the future
                redisConnection.SADD(auctionId, creative.id, (err, response) => {
                    if (err) return callback(err);
                    // release lock now that creative has been added
                    lock.unlock().then(() => {
                        // set key to expire in EXPIRE_SECONDS so redis doesn't fill up unbounded
                        redisConnection.EXPIRE(auctionId, EXPIRE_SECONDS);
                    }).catch((err) => {
                        logger.error(err);
                    });
                    return callback(null, creative);
                });
            }
        });
    }).catch((err) => {
        logger.error(err);
    });
};