/* jshint node: true */
'use strict';
const express = require('express'),
    urls = require('@cliques/cliques-node-utils').urls;

module.exports = function(db, logger, httpConfig){

    const actions = require('./controllers/action.server.controller')(db, logger, httpConfig),
        clicks = require('./controllers/click.server.controller')(db, logger, httpConfig),
        test = require('./controllers/test.server.controller')(db, logger, httpConfig),
        impressions = require('./controllers/impression.server.controller')(db, logger, httpConfig);

    let router = express.Router();

    /* -------------------------- ROOT ------------------------- */
    router.route('/').get((req, res) => { res.status(200).send('Cliques AdServer'); });

    /* --------------------------------------------------------- */
    /* ----------------- IMPRESSION Endpoints ------------------ */
    /* --------------------------------------------------------- */
    router.route(urls.IMP_PATH).get(impressions.creativegroup);
    router.route(urls.CR_PATH).get(impressions.creative);
    router.route(urls.PUBCR_PATH).get(impressions.pubCreative);

    /* --------------------------------------------------------- */
    /* ---------------------- CLICK Endpoints ------------------ */
    /* --------------------------------------------------------- */
    router.route(urls.CLICK_PATH).get(clicks.click);


    /* --------------------------------------------------------- */
    /* --------------------- ACTION Endpoints ------------------ */
    /* --------------------------------------------------------- */
    router.route(urls.ACTION_PATH).get(actions.action);

    if (process.env.NODE_ENV !== 'production') {
        router.route('/test_ad').get(test.testAd);
    }
    return router;
};





