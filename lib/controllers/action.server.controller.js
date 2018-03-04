const node_utils = require('@cliques/cliques-node-utils'),
    urls = node_utils.urls;

module.exports = function(db, logger, httpConfig){
    return {
        /**
         * Endpoint to handle conversions (actions)
         */
        action: function(request, response){
            const secure = (request.protocol === 'https');
            const port = secure ? httpConfig.httpsPort: httpConfig.httpPort;
            const actURL = new urls.ActionBeaconURL(httpConfig.httpHostname, httpConfig.httpsHostname, port);
            actURL.parse(request.query, secure);
            response.status(200).send();
            logger.action(request, response, actURL);
        }
    }
};