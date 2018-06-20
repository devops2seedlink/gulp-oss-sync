var pad = require('pad-component'),
  colors = require('ansi-colors');
  fancyLog = require('fancy-log');
  through = require('through2');

/**
 * create a log reporter
 * @param {Object} options reporter options
 *
 * available options are:
 *   - states: list of state to log (default to all)
 */

module.exports = function(options) {
  if (!options) options = {};

  var stream = through.obj(function (file, enc, cb) {
    var state;
    if (!file.oss) return cb(null, file);
    if (!file.oss.state) return cb(null, file);
    if (options.states &&
        options.states.indexOf(file.oss.state) === -1) return cb(null, file);

    state = '[oss][' + file.oss.state + ']';
    state = pad.right(state, 8);

    switch (file.oss.state) {
      case 'create':
        state = colors.green(state);
        break;
      case 'delete':
        state = colors.red(state);
        break;
      case 'update':
        state = colors.yellow(state);
        break;
      default:
        state = colors.cyan(state);
        break;
    }

    fancyLog(state, file.oss.path);
    cb(null, file);
  });

  // force flowing mode
  // @see http://nodejs.org/docs/latest/api/stream.html#stream_event_end
  // @see https://github.com/pgherveou/gulp-awspublish/issues/13
  stream.resume();
  return stream;
};
