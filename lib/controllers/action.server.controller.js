const node_utils = require('@cliques/cliques-node-utils'),
    config = require('config'),
    serverToServer = require('../serverToServer'),
    urls = node_utils.urls;

// Get server-to-server URLs, if there are any.
let serverToServerConfig = serverToServer.getAndValidateS2SConfig('AdServer.serverToServer.onAction');

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
            // fire off server-to-server request, if there is one
            if (serverToServerConfig){
                serverToServer.sendRequest('impression', serverToServerConfig, actURL.external, logger);
            }
        }
    }
};