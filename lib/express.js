//first-party packages
var node_utils = require('cliques_node_utils');
var cliques_cookies = node_utils.cookies;
var logger = require('./logger');

//third-party packages
//have to require PMX before express to enable monitoring
var pmx = require('pmx').init();
var express = require('express');
var https = require('https');
var http = require('http');
var app = express();
var fs = require('fs');
var requestIp = require('request-ip');
var cookieParser = require('cookie-parser');
var responseTime = require('response-time');
var config = require('config');

module.exports = function(userConnection){
    /* ------------------- EXPRESS MIDDLEWARE ------------------- */

    // inside request-ip middleware handler
    app.use(function(req, res, next) {
        req.clientIp = requestIp.getClientIp(req); // on localhost > 127.0.0.1
        next();
    });
    app.use(cookieParser());
    app.use(responseTime());
    app.set('HTTP_PORT', (config.get('AdServer.http.port') || 5000));
    app.set('HTTPS_PORT', (config.get('AdServer.https.port') || 3000));
    app.use(express.static(__dirname + '/public'));

    // custom cookie-parsing middleware
    var days_expiration = config.get('Cookies.expirationdays');
    var domain = config.get('Cookies.domain');
    var cookie_handler = new cliques_cookies.CookieHandler(days_expiration,domain,userConnection);
    app.use(function(req, res, next){
        cookie_handler.get_or_set_uuid(req, res, next);
    });

    // custom HTTP request logging middleware
    app.use(function(req, res, next){
        logger.httpRequestMiddleware(req, res, next);
    });

    http.createServer(app).listen(app.get('HTTP_PORT'));
    https.createServer({
        key: fs.readFileSync('./config/cert/star_cliquesads_com.key'),
        cert: fs.readFileSync('./config/cert/star_cliquesads_com.crt'),
        ca: fs.readFileSync('./config/cert/DigiCertCA.crt')
    }, app).listen(app.get('HTTPS_PORT'));

    return app;
};