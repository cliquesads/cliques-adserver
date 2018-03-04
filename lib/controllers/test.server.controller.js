/* jshint node: true */
'use strict';

const pug = require('pug'),
    node_utils = require('@cliques/cliques-node-utils'),
    tags = node_utils.tags,
    urls = node_utils.urls;

module.exports = function(db, logger, httpConfig){
    const advertiser_models = new node_utils.mongodb.models.AdvertiserModels(db);
    return {
        testAd: function(request, response){
            const secure = request.protocol === 'https';
            const hostname = secure ? httpConfig.httpsHostname : httpConfig.httpHostname;
            const external_port = secure ? httpConfig.httpsPort: httpConfig.httpPort;
            const impTag = new tags.ImpTag(hostname, {
                port: external_port,
                secure: secure
            });
            const PLACEMENT_ID = "54f8df2e6bcc85d9653becfb";
            advertiser_models.getNestedObjectById(request.query.crgid, 'CreativeGroup', function(err, obj){
                if (err) {
                    logger.error('Error trying to query creativeGroup from DB: ' + err);
                    response.status(500).send('Something went wrong');
                    return;
                }
                let rendered = impTag.render(obj);
                rendered = urls.expandURLMacros(rendered, { pid: PLACEMENT_ID});
                const fn = pug.compileFile('./templates/test_ad.pug', null);
                const html = fn({ imptag: rendered, pid: PLACEMENT_ID});
                response.send(html);
            });
        }
    };
};