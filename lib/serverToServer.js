/* jshint node: true */
'use strict';

const request = require('request'),
    node_utils = require('@cliques/cliques-node-utils'),
    backoff = require('backoff'),
    urls = node_utils.urls;

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
    const call = backoff.call(request, requestOptions, function(err, res) {
        retries= call.getNumRetries();
        error = err;
        response = res;
        if (err) {
            // just print an error to log if it errors indicating number of retries
            const retriesLeft = requestOptions.retries - retries;
            logger.error(`Error making server-to-server call to ${url}: ${err.message}. 
                Will retry ${retriesLeft} more times.`);
        } else {
            // log if successful, means it won't be retried
            logger.s2s(eventType, url, requestOptions.method, retries, err, res);
        }
    });

    // call.retryIf(function(err) { return err.status === 503; });
    call.setStrategy(new backoff.ExponentialStrategy());
    call.failAfter(s2sConfig.retries);
    call.start();

    call.on('abort', function(){
        logger.s2s(eventType, url, requestOptions.method, retries, error, response);
    });
};