/* jshint node: true */
'use strict';

var winston = require('winston');
var config = require('config');
var logger = require('./logger');

var EXPIRE_SECONDS = 5;
var RETRIES = 10;
var screenshotLimits = config.get('AdServer.screenshotLimits');

/**
 * Atomically gets unique creative ID from creativegroup
 *
 * @type {exports.getCreative}
 */
var getCreative = exports.getCreative = function(auctionId, creativegroup, callback){
    var redisConnection = winston.transports.GetDefaultRedisClient();
    if (!redisConnection) {
        return logger.error('CREATIVE LOOKER UPPER: No redis connection');
    }

    function _inner(cb){
        redisConnection.WATCH(auctionId);
        redisConnection.SMEMBERS(auctionId, k, function(err, creativeIds) {
            if (err) return cb(err);
            var creatives = [];
            // push remaining creatives to weighted creatives array
            creativegroup.creatives.forEach(function(item){
                // filter on active flag
                // & whether or not creative has already been served
                if (item.active && creativeIds.indexOf(item._id) === -1){
                    for (var i= 0; i < item.weight; i++){
                        creatives.push(item);
                    }
                }
            });
            // select random weighted creative
            var creative = creatives[Math.floor(Math.random()*creatives.length)];
            var multi = redisConnection.MULTI();
            // add creative ID to redis set so it can't be selected in the future
            multi.SADD(auctionId, creative._id);
            // add expiration to auctionId set
            multi.EXPIRE(auctionId, EXPIRE_SECONDS);
            // finally, exec to execute the transaction
            multi.EXEC(function(err, response){
                if (err || !response) return cb(err);
                return cb(null, creative);
            });
        });
    }

    // ignore retries for now
    return _inner(callback);
};
