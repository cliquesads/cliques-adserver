var url = require('url');
var config = require('config');
var util = require('util');

var IMP_PATH = '/crg';
var CLICK_PATH = '/clk';
var CONV_PATH = '/cnv';
var DOMAIN = config.get('AdServer.http.domain');

/**
 * Abstract class to contain base methods used for constructing & parsing
 * adserver URL's.
 *
 * @param {Object} query_schema object containing query parameters expected for a
 *  given URL that specifies the level of encoding / decoding to perform for each
 * @param {String} path path for this URL
 * @constructor
 */
var AdServerURL = function(query_schema, path){
    this.host           = DOMAIN;
    this.path           = path;
    //contains query fields to expect & levels of encoding expected for each
    this.query_schema   = query_schema || {};
};

/**
 * Parses & decodes URL query params from raw URL
 *
 * Doesn't actually parse the whole string since Express parses out query params for
 * you into an object, so just pass request.query as query argument.
 *
 * @param {Object} query output of request.query
 * @param {Boolean} secure
 */
AdServerURL.prototype.parse = function(query, secure){
    var self = this;
    self.secure = secure;
    Object.keys(query).forEach(function(item){
        if (query.hasOwnProperty(item)){
            // decode as necessary
            self[item] = query[item];
            for (var d=0; d < self.query_schema[item]; d++){
                self[item] = decodeURIComponent(self[item])
            }
        }
    });
};

/**
 * Lightweight wrapper around url.format to encode any query params which are
 * expected to be encoded, and return fully formed URL.
 *
 * Stores resulting URL on instance as this.url
 *
 * @param {Object} query object containing a URL's query param keys & values
 * @param {Boolean} secure
 */
AdServerURL.prototype.format = function(query, secure){
    var self = this;
    query = query || {};
    // encode all query params appropriate number of times
    for (var key in query){
        if (query.hasOwnProperty(key)){
            for (var d=0; d < self.query_schema[key]; d++) {
                query[key] = encodeURIComponent(query[key])
            }
        }
    }
    this.url = url.format({
        protocol: secure ? 'https' : 'http',
        host: self.host,
        pathname: self.path,
        query: query
    });
    return this.url;
};

var ImpURL = function(){
    var query_schema = {
        crgid: 0,
        pid: 0,
        impid: 0
    };
    AdServerURL.call(this, query_schema, IMP_PATH);
};
util.inherits(ImpURL, AdServerURL);

var ClickURL = function(){
    var query_schema = {
        cid: 0,
        pid: 0,
        redir: 1
    };
    AdServerURL.call(this, query_schema, CLICK_PATH);
};
util.inherits(ClickURL, AdServerURL);

var ConvURL = function(){
    var query_schema = {
        tagid: 0,
    };
    AdServerURL.call(this, query_schema, CONV_PATH);
};

util.inherits(ConvURL, AdServerURL);

exports.ImpURL = ImpURL;
exports.ClickURL = ClickURL;
exports.ConvURL = ConvURL;
exports.IMP_PATH = IMP_PATH;
exports.CLICK_PATH = CLICK_PATH;
exports.CONV_PATH = CONV_PATH;