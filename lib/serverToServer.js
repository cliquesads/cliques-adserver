/* jshint node: true */
'use strict';

const request = require('request'),
    node_utils = require('@cliques/cliques-node-utils'),
    backoff = require('backoff'),
    config = require('config'),
    urls = node_utils.urls;


exports.getAndValidateS2SConfig = function(eventConfigKey){
    let serverToServerConfig;
    try {
        let _config = config.get(eventConfigKey);
        _config = config.util.toObject(_config);
        if (!_config.requestOptions.url || !_config.requestOptions.method){
            throw Error('Invalid serverToServer requestOptions defined in config. You must provide `method` and `url` options.')
        } else {
            serverToServerConfig = _config;
        }
    } catch(error){
        serverToServerConfig = false;
        console.warn(`WARNING: Could not validate serverToServerConfig for event key ${eventConfigKey}, 
            serverToServer will not be configured for this event.`);
        console.warn(`The following error was thrown when trying to validate config: ${error.message}`);
    }
    return serverToServerConfig;
};

/**
 * Sends request to server-to-server endpoint w/ exponential backoff, according
 * to `s2sConfig` parameter. `s2sConfig` assumes the following format:
 *
 * ```
 * {
 *   "requestOptions": {
 *     "method": "GET",
 *     "url": "http://localhost:5000/dummyImp?fakeId=${FAKEID}&fakerId=${FAKERID}"
 *     // add any other options here acceptable by `request`, full list found
 *     // [here](https://github.com/request/request#requestoptions-callback)
 *   },
 *   "retries": 5
 * }
 * ```
 * `requestOptions` object will be passed directly to `request` constructor.
 *
 * We will attempt to expand macros in `url` and `uri` properties will using
 * `urls.expandURLMacros` method with object passed in `external` argument.
 * Otherwise, request options object will be passed untouched.
 *
 * Uses backoff to perform exponential backoff in the event of failure, will retry
 * `retries` # of times.
 *
 * @param eventType
 * @param s2sConfig
 * @param external
 * @param logger
 */
exports.sendRequest = function(eventType, s2sConfig, external, logger){

    const requestOptions = s2sConfig.requestOptions;
    // expand URL macros (${MACRO}) with values in `external` object, which
    // should be accessible via the AdServerURL object instantiated in the caller.
    let url;
    if (requestOptions.url){
        requestOptions.url = urls.expandURLMacros(requestOptions.url,external);
        url = requestOptions.url;
    } else if (s2sConfig.requestOptions.uri) {
        requestOptions.uri = urls.expandURLMacros(requestOptions.uri,external);
        url = requestOptions.uri;
    }

    let error, response, retries;
    const exponentialBackoff = backoff.exponential({});
    exponentialBackoff.failAfter(s2sConfig.retries);

    exponentialBackoff.on('backoff', function(number, delay){
        logger.info(`Backoff #${number}: ${delay}ms`);
    });

    exponentialBackoff.on('ready', function(number, delay){
        request(requestOptions, function(err, res){
            response = res;
            // TODO: don't consider 300's errors here, might want to create a separate
            // TODO: event for 300's in the future and warn if they exceed a threshold
            if (err || res.statusCode < 200 || res.statusCode > 399) {
                // just print an error to log if it errors indicating number of retries
                const retriesLeft = s2sConfig.retries - number - 1;
                retries = number;
                error = res.statusMessage;
                logger.error(`S2S call to ${url} returned error code ${res.statusCode}: ${res.statusMessage}. Will retry ${retriesLeft} more times.`);
                exponentialBackoff.backoff();
            } else {
                // log if successful, means it won't be retried
                logger.s2s(eventType, url, requestOptions.method, retries, err, res);
                exponentialBackoff.reset();
            }
        });
    });

    exponentialBackoff.on('fail', function(){
        logger.s2s(eventType, url, requestOptions.method, retries, error, response);
    });

    exponentialBackoff.backoff();
};