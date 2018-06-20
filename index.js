/**
 * This file is based on gulp-awspublish
 */

const OSS = require('ali-oss');
const co = require('co');
const fs = require('fs');
const through = require('through2');
const crypto = require('crypto');
const mime = require('mime');
const gutil = require('gulp-util');
const Vinyl = require('vinyl');
const Stream = require('stream');
const path = require('path');
const reporter = require('./log-reporter');

let PLUGIN_NAME = 'gulp-oss-sync';

/**
 * calculate file hash
 * @param  {Buffer} buf
 * @return {String}
 *
 * @api private
 */

function md5Hash (buf) {
  return crypto
    .createHash('md5')
    .update(buf)
    .digest('hex');
}

/**
 * Determine the content type of a file based on charset and mime type.
 * @param  {Object} file
 * @return {String}
 *
 * @api private
 */

function getContentType (file) {
  let mimeType = mime.lookup(file.unzipPath || file.path);
  let charset = mime.charsets.lookup(mimeType);

  return charset
    ? mimeType + '; charset=' + charset.toLowerCase()
    : mimeType;
}

/**
 * init file oss hash
 * @param  {Vinyl} file file object
 *
 * @return {Vinyl} file
 * @api private
 */

function initFile (file, prefix) {
  if (!file.oss) {
    file.oss = {};
    file.oss.headers = {};
    file.oss.path = path.join(prefix, file.relative.replace(/\\/g, '/'));
  }
  return file;
}

/**
 * create a through stream that print oss status info
 * @param {Object} param parameter to pass to logger
 *
 * @return {Stream}
 * @api public
 */

module.exports.reporter = function(param) {
  return reporter(param);
};

/**
 * create a through stream that save file in cache
 *
 * @return {Stream}
 * @api public
 */

Publisher.prototype.cache = function() {
  let _this = this,
      counter = 0;

  function saveCache() {
    fs.writeFileSync(_this.getCacheFilename(), JSON.stringify(_this._cache));
  }

  let stream = through.obj(function (file, enc, cb) {
    if (file.oss && file.oss.path) {

      // do nothing for file already cached
      if (file.oss.state === 'cache') return cb(null, file);

      // remove deleted
      if (file.oss.state === 'delete') {
        delete _this._cache[file.oss.path];

      // update others
      } else if (file.oss.etag) {
        _this._cache[file.oss.path] = file.oss.etag;
      }

      // save cache every 10 files
      if (++counter % 10) saveCache();
    }

    cb(null, file);
  });

  stream.on('finish', saveCache);

  return stream;
};

/**
 * filter
 * @param  {String} key filepath
 * @param  {Array} whitelist list of expressions that match against files that should not be deleted
 *
 * @return {Boolean} shouldDelete whether the file should be deleted or not
 * @api private
 */

function fileShouldBeDeleted (key, whitelist) {
  for (let i = 0; i < whitelist.length; i++) {
    let expr = whitelist[i];
    if (expr instanceof RegExp) {
      if (expr.test(key)) {
        return false;
      }
    } else if (typeof expr === 'string') {
      if (expr === key) {
        return false;
      }
    } else {
      throw new Error('whitelist param can only contain regular expressions or strings');
    }
  }
  return true;
}

/**
 * create a new Publisher
 * @param {Object} OSS options as per https://help.aliyun.com/document_detail/32070.html
 * @api public
 */

/**
 * ossConfig = {
 *  connect: {},
 *  controls: {},
 *  setting: {}
 * }
 *
 */

function Publisher (ossConfig, cacheOptions) {
  this.config = ossConfig;
  this.setting = this.config.setting || {prefix: '', createOnly: false, force: false, simulate: false, whitelistedFiles: []};
  this.setting.prefix = !!this.config.setting.prefix ? this.config.setting.prefix : '';
  this.setting.whitelistedFiles = !!this.config.setting.whitelistedFiles ? this.config.setting.whitelistedFiles : [];
  this.setting.createOnly = !!this.config.setting.createOnly;
  this.setting.force = !!this.config.setting.force;
  this.setting.simulate = !!this.config.setting.simulate;
  this.client = new OSS(ossConfig.connect);
  let bucket = this.config.connect.bucket;

  if (!bucket) {
    throw new Error('Missing `connect.bucket` config value.');
  }

  // init Cache file
  this._cacheFile = cacheOptions && cacheOptions.cacheFileName
    ? cacheOptions.cacheFileName
    : '.oss-cache-' + bucket;

  // load cache
  try {
    this._cache = JSON.parse(fs.readFileSync(this.getCacheFilename(), 'utf8'));
  } catch (err) {
    this._cache = {};
  }
}

/**
 * generates cache filename.
 * @return {String}
 * @api private
 */

Publisher.prototype.getCacheFilename = function () {
  return this._cacheFile;
};

/**
 * Sync file in stream with file in the oss bucket
 * @param {String} prefix prefix to sync a specific directory
 * @param {Array} whitelistedFiles list of expressions that match against files that should not be deleted
 *
 * @return {Stream} a transform stream that stream both new files and delete files
 * @api public
 */

 Publisher.prototype.sync = function() {
  let client = this.client,
      prefix = this.config.setting.prefix,
      whitelistedFiles = this.config.setting.whitelistedFiles,
      stream = new Stream.Transform({ objectMode : true }),
      newFiles = {};

  // push file to stream and add files to oss path to list of new files
  stream._transform = function(file, encoding, cb) {
    newFiles[file.oss.path] = true;
    this.push(file);
    cb();
  };

  stream._flush = function(cb) {
    let toDelete = [],
        lister;
    co(function* () {
        lister = yield client.list({ prefix: prefix });
        let deleteFile;
        let key;
        for(let i = 0; i < lister.objects.length; i++) {
          key = lister.objects[i].name;
          if (newFiles[key]) continue;
          if (!fileShouldBeDeleted(key, whitelistedFiles)) continue;
          deleteFile = new Vinyl({});
          deleteFile.oss = {
            path: key,
            state: 'delete',
            headers: {}
          };
          stream.push(deleteFile);
          toDelete.push(key);
        }
        if(toDelete.length > 0){
          yield client.deleteMulti(toDelete, {
            quiet: true
          });
        }
    }).catch(function (err) {
      cb(err);
    });
  };

  return stream;
};

/**
 * create a through stream that publish files to oss
 * @options {Object} options
 *
 * available options are:
 * - force {Boolean} force upload
 * - simulate: debugging option to simulate oss upload
 * - createOnly: skip file updates
 *
 * @return {Stream}
 * @api public
 */

Publisher.prototype.publish = function () {
  const _this = this;

  let options = _this.config.setting;

  const stream = through.obj(function (file, enc, cb) {
    let etag;
    let headObj;
    let noUpdate;
    let noChange;

    // Do nothing if no contents
    if (file.isNull()) return cb();

    // streams not supported
    if (file.isStream()) {
      this.emit('error',
        new gutil.PluginError(PLUGIN_NAME, 'Stream content is not supported'));
      return cb();
    }

    // check if file.contents is a `Buffer`
    if (file.isBuffer()) {
      initFile(file, options.prefix);

      // calculate etag
      etag = '"' + md5Hash(file.contents) + '"';

      // delete - stop here
      if (file.oss.state === 'delete') return cb(null, file);

      // add content-type header
      if (!file.oss.headers['Content-Type']) file.oss.headers['Content-Type'] = getContentType(file);

      // add content-length header
      if (!file.oss.headers['Content-Length']) file.oss.headers['Content-Length'] = file.contents.length;

      if (options.simulate) return cb(null, file);

      const controls = _this.config.controls || {};
      controls.headers = Object.assign({}, controls.headers, file.oss.headers);
      co(function* () {
        try{
          //console.log(file.oss.path);
          headObj = yield _this.client.head(file.oss.path);
        }catch (err) {
          //console.log(err);
          if (err && err.code != 'NoSuchKey'){
            cb(err, file);
          }
        }
        noUpdate = options.createOnly && headObj && headObj.res && headObj.res.headers.etag;
        noChange = !options.force && headObj && headObj.res && headObj.res.headers.etag.toLowerCase() === etag.toLowerCase();
        if (noUpdate || noChange) {
          file.oss.state = 'skip';
          file.oss.etag = etag;
          file.oss.date = new Date(headObj.res.headers['last-modified']);
          cb(null, file);
        } else{
          file.oss.state = headObj && headObj.res && headObj.res.headers.etag ? 'update' : 'create';
          file.oss.etag = etag;
          yield _this.client.put(file.oss.path, file.contents, controls);
          cb(null, file);
        }
      }).catch(function (err) {
        cb(err, file);
      });
    }
  });
  return stream;
};

/**
 * export Publisher.create
 *
 * @param {Object} ossConfig
 * @param {Object} cacheOptions
 * @return {Publisher}
 *
 * @api public
 */
exports.create = function (ossConfig, cacheOptions) {
  return new Publisher(ossConfig, cacheOptions);
};
