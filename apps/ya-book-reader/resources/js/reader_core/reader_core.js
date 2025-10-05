(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.ReaderCore = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

/**
 * Shim for requestAnimationFrame.
 * @type {Function}
 */
var requestAnimationFrameShim = function(callback) {
  if (window.requestAnimationFrame) {
    window.requestAnimationFrame(callback);
  } else if (window.mozRequestAnimationFrame) {
    window.mozRequestAnimationFrame(callback);
  } else if (window.webkitRequestAnimationFrame) {
    window.webkitRequestAnimationFrame(callback);
  } else if (window.msRequestAnimationFrame) {
    window.msRequestAnimationFrame(callback);
  } else {
    setTimeout(callback, 17);
  }
};

/**
 * Shim for requestIdleCallback.
 * @type {Function}
 */
var requestIdleCallbackShim = function(callback) {
  if (window.requestIdleCallback) {
    window.requestIdleCallback(callback);
  } else {
    var start = Date.now();
    return requestAnimationFrameShim(function() {
      callback({
        didTimeout: false,
        timeRemaining: function() {
          return Math.max(0, 50 - (Date.now() - start));
        }
      });
    });
  }
};

/**
 * Call callback with every number between from and two. Next will be called
 * only after previous processing finished.
 * @param {number} from
 * @param {number} to
 * @param {function} callback
 * @return {Promise.<T>}
 */
var asyncFor = function(from, to, callback) {
  if (from >= to) {
    return Promise.resolve([]);
  }

  return new Promise(function(resolve, reject) {
    var result = [];
    var i = from;

    var handleCallbackResult = function(deadline, callbackResult) {
      result.push(callbackResult);
      i++;

      if (i >= to) {
        resolve(result);
      } else if (deadline.timeRemaining() > 0) {
        processNextItem(deadline);
      } else {
        requestIdleCallbackShim(processNextItem);
      }
    };

    var processNextItem = function(deadline) {
      var callbackResult;
      try {
        callbackResult = callback.call(null, i);
      } catch (error) {
        reject(error);
        return;
      }

      if (callbackResult instanceof Promise) {
        callbackResult.then(function(asyncCallbackResult) {
          handleCallbackResult(deadline, asyncCallbackResult);
        }, function(error) {
          reject(error);
        });
      } else {
        handleCallbackResult(deadline, callbackResult);
      }
    };

    requestIdleCallbackShim(processNextItem);
  });
};

/**
 * Process every array item with async callback. Next item will be processed
 * only after previous processing finished.
 * @param {Array} array
 * @param {function} callback
 * @return {Promise}
 */
var asyncMap = function(array, callback) {
  return asyncFor(0, array.length, function(i) {
    return callback(array[i], i);
  });
};

/**
 * Waits for timeoutMilliseconds.
 * @param {Function} func
 * @param {number} timeoutMilliseconds
 * @return {Function}
 */
var delay = function(func, timeoutMilliseconds) {
  var timeoutId = null;
  var savedArgs = null;
  var savedThis = null;

  return function() {
    savedArgs = arguments;
    savedThis = this;

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(function() {
      func.apply(savedThis, savedArgs);
      timeoutId = savedArgs = savedThis = null;
    }, timeoutMilliseconds);
  };
};

// Exports.
module.exports = {
  asyncFor: asyncFor,
  asyncMap: asyncMap,
  delay: delay,
  requestAnimationFrame: requestAnimationFrameShim,
  requestIdleCallback: requestIdleCallbackShim
};

},{}],2:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

/**
 * Long process cancellation token.
 * @constructor
 */
function CancellationToken() {
  this.cancelled_ = false;
}

/**
 * Throws exception if token already cancelled.
 */
CancellationToken.prototype.throwIfCancelled = function() {
  if (this.isCancelled()) {
    throw new Error('cancelled');
  }
};

/**
 * Check if token is cancelled.
 * @return {boolean}
 */
CancellationToken.prototype.isCancelled = function() {
  return this.cancelled_;
};

/**
 * Cancel token.
 */
CancellationToken.prototype.cancel = function() {
  this.cancelled_ = true;
};

// Exports.
module.exports = CancellationToken;

},{}],3:[function(require,module,exports){
// Copyright (c) 2016 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

// Dependencies.
var CfiStep = require('./cfi_step');

/**
 * Book cfi.
 * @param {Array.<CfiStep>=} opt_steps
 * @constructor
 */
function Cfi (opt_steps) {
  this.steps_ = opt_steps ? Array.prototype.slice.call(opt_steps) : [];
}

/**
 * Push step.
 * @param {CfiStep|string} step
 * @return {number}
 */
Cfi.prototype.pushStep = function(step) {
  if (typeof step === 'string') {
    step = CfiStep.parseFromString(step);
  }

  return this.steps_.push(step);
};

/**
 * Pop step.
 * @return {CfiStep}
 */
Cfi.prototype.popStep = function() {
  return this.steps_.pop();
};

/**
 * Shift step.
 * @param {CfiStep|string} step
 * @return {number}
 */
Cfi.prototype.unshiftStep = function(step) {
  if (typeof step === 'string') {
    step = CfiStep.parseFromString(step);
  }

  return this.steps_.unshift(step);
};

/**
 * Shift step.
 * @return {CfiStep}
 */
Cfi.prototype.shiftStep = function() {
  return this.steps_.shift();
};

/**
 * Steps count.
 * @return {*}
 */
Cfi.prototype.stepsLength = function() {
  return this.steps_.length;
};

/**
 * Get steps string.
 * @return {string}
 */
Cfi.prototype.toString = function() {
  return this.steps_.length ? ('/' + this.steps_.join('/')) : '';
};

/**
 * Parse cfi from string.
 * @param {string} cfiString
 * @return {Cfi}
 * @static
 */
Cfi.parseFromString = function(cfiString) {
  if (!cfiString) {
    return new Cfi();
  }

  var steps = cfiString
      .replace(/^\//, '')
      .split('/').map(function(cfiStepString) {
        return CfiStep.parseFromString(cfiStepString);
      });
  return new Cfi(steps);
};

/**
 * Find cfi for element.
 * @param {Element} element
 * @static
 */
Cfi.getElementCfi = function(element) {
  var stack = [];
  while (element) {
    stack.push(element);
    element = element.parentElement;
  }

  var cfi = new Cfi();
  var currentParent = stack.pop();
  var currentElement = stack.pop();
  while (currentElement) {
    var indexOfElement = Array.prototype.indexOf.call(
        currentParent.children, currentElement);
    cfi.pushStep(new CfiStep({childReference: indexOfElement * 2 + 2}));

    currentParent = currentElement;
    currentElement = stack.pop();
  }

  return cfi;
};

// Exports.
module.exports = Cfi;

},{"./cfi_step":5}],4:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

/**
 * Book document cfi builder.
 * @param {Cfi=} opt_cfi
 * @constructor
 */
function CfiBuilder (opt_cfi) {
  this.steps_ = [];
  this.cfiValues_ = [];
  this.level_ = -1;
  this.currentStep_ = null;
  this.currentCfi_ = '';

  if (opt_cfi && opt_cfi.stepsLength() > 0) {
    var step = opt_cfi.popStep();
    this.currentStep_ = step.getChildReference();
    this.currentCfi_ = opt_cfi.toString();

    this.level_++;

    while (step = opt_cfi.popStep()) {
      this.cfiValues_.unshift(opt_cfi.toString());
      this.steps_.unshift(step.getChildReference());
      this.level_++;
    }
  }
}

/**
 * Enter child folder (move deeper in tree).
 */
CfiBuilder.prototype.enterChild = function() {
  if (this.level_ >= 0) {
    this.steps_[this.level_] = this.currentStep_;
    this.cfiValues_[this.level_] = this.currentCfi_;
    this.currentCfi_ += '/' + this.currentStep_;
  }
  this.currentStep_ = 1;

  this.level_++;
};

/**
 * Leave child folder (move up in tree).
 */
CfiBuilder.prototype.leaveChild = function() {
  this.level_--;
  if (this.level_ > -1) {
    this.currentStep_ = this.steps_[this.level_];
    this.currentCfi_ = this.cfiValues_[this.level_];
  } else if (this.level_ === -1) {
    this.currentStep_ = null;
    this.currentCfi_ = '';
  } else {
    throw new Error('Builder can not leave root');
  }
};

/**
 * Go to next element (move along tree).
 */
CfiBuilder.prototype.nextSibling = function() {
  this.currentStep_++;
};

/**
 * Get current cfi.
 * @return {string}
 */
CfiBuilder.prototype.toString = function() {
  return this.currentStep_ ?
      (this.currentCfi_ + '/' + this.currentStep_) : '';
};

// Exports.
module.exports = CfiBuilder;

},{}],5:[function(require,module,exports){
// Copyright (c) 2016 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

/**
 * Book cfi step.
 * @param {Object} params
 * @constructor
 */
function CfiStep(params) {
  this.childReference_ = params.childReference;
  this.isIndirect_ = !!params.isIndirect;
}

/**
 * Get child reference.
 * @return {number}
 */
CfiStep.prototype.getChildReference = function() {
  return this.childReference_;
};

/**
 * Return true if child reference is indirect.
 * @return {boolean}
 */
CfiStep.prototype.getIsIndirect = function() {
  return this.isIndirect_;
};

/**
 * Save cfi step as string.
 * @return {string}
 */
CfiStep.prototype.toString = function() {
  return '' +
      (typeof this.childReference_ === 'number' ? this.childReference_ : '') +
      (this.isIndirect_ ? '!' : '');
};


/**
 * Parse cfi step from string.
 * @param {string} stepString
 * @return {CfiStep}
 * @static
 */
CfiStep.parseFromString = function(stepString) {
  var result = /^(\d+)(\[([a-zA-Z0-9\-_]+)])?(!)?$/.exec(stepString);
  if (!result) {
    throw new Error('Can not parse cfi step string: "' + stepString + '". ' +
        'Cfi standard currently is not fully supported.');
  }

  return new CfiStep({
    childReference: parseInt(result[1], 10),
    isIndirect: result[4] === '!'
  });
};

// Exports.
module.exports = CfiStep;

},{}],6:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

/**
 * Extends child class with parent.
 * @param {function} Child
 * @param {function} Parent
 */
var extend = function(Child, Parent) {
  var F = function() { };
  F.prototype = Parent.prototype;
  Child.prototype = new F();
  Child.prototype.constructor = Child;
  Child.superclass = Parent.prototype;
};

// Exports.
module.exports = {
  extend: extend,
};

},{}],7:[function(require,module,exports){
// Copyright 2014 Yandex LLC. All rights reserved.
// Author: Andrey Ivlev <skyh@yandex-team.ru>
// Author: Valentin Shergin <shergin@yandex-team.ru>
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

/**
 * Custom events base class for non DOM objects.
 * @constructor
 */
function EventEmitter() {
  this.listeners_ = Object.create(null);
}

/**
 * Get all listeners for event.
 * @param {string} type
 * @return {Array.<Function>}
 * @private
 */
EventEmitter.prototype.getListenersForEvent_ = function(type) {
  if (!Object.prototype.hasOwnProperty.call(this.listeners_, type)) {
    this.listeners_[type] = [];
  }

  return this.listeners_[type];
};

/**
 * Add listener to event.
 * @param {string} type
 * @param {Function} listener
 */
EventEmitter.prototype.addEventListener = function(type, listener) {
  if (!(listener instanceof Function)) {
    throw new TypeError('Only function can be event listener.');
  }

  var eventListeners = this.getListenersForEvent_(type);
  if (eventListeners.indexOf(listener) !== -1) {
    throw new TypeError('Listener already listening this event.');
  }

  eventListeners.push(listener);
};

/**
 * Remove listener from event.
 * @param {string} type
 * @param {Function} listener
 */
EventEmitter.prototype.removeEventListener = function(type, listener) {
  var eventListeners = this.getListenersForEvent_(type);
  var index = eventListeners.indexOf(listener);
  if (index === -1) {
    throw new TypeError('Listener not found.');
  }

  eventListeners.splice(index, 1);
};

/**
 * Dispatch event with provided arguments.
 * @param {string} type
 * @protected
 */
EventEmitter.prototype.dispatchEvent_ = function(type) {
  var eventListeners = this.getListenersForEvent_(type).slice();
  var eventArguments = Array.prototype.slice.call(arguments, 1);
  eventListeners.forEach(function(listener) {
    try {
      listener.apply(null, eventArguments);
    } catch (e) {
      // Ok.
    }
  });
};

/**
 * Remove all listeners.
 * @protected
 */
EventEmitter.prototype.removeAllEventListeners_ = function() {
  this.listeners_ = Object.create(null);
};

/**
 * Remove all listeners and all internal data.
 */
EventEmitter.prototype.dispose = function() {
  this.removeAllEventListeners_();
};

module.exports = EventEmitter;

},{}],8:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

/**
 * Loads header from url.
 * @param {string} url
 * @param {Array.<string>} headers
 * @return {Promise.<Array.<string>>}
 */
var requestHeaders = function(url, headers) {
  return new Promise(function(resolve, reject) {
    var request = new XMLHttpRequest();
    request.addEventListener('load', function() {
      // When requesting blobs, status can be equals to zero.
      if (request.status !== 200 && request.status !== 0) {
        reject('Not expected request status: ' + request.status);
        return;
      }

      var headersValues = {};
      headers.forEach(function(header) {
        headersValues[header] = request.getResponseHeader(header);
      });
      resolve(headersValues);
    });
    request.addEventListener('error', reject);
    request.open('HEAD', url);
    request.send();
  });
};

/**
 * Loads text from url.
 * @param {string} url
 * @param {string} type
 * @return {Promise.<string>}
 */
var request = function(url, type) {
  return new Promise(function(resolve, reject) {
    var handleLoad = function() {
      // When requesting blobs, status can be equals to zero.
      if (request.status !== 200 && request.status !== 0) {
        reject('Not expected request status: ' + request.status);
        return;
      }

      var contentLengthHeader = request.getResponseHeader('Content-Length');
      resolve({
        result: type === 'text' ? request.responseText : request.responseXML,
        size: contentLengthHeader ?
            parseInt(contentLengthHeader, 10) : request.responseText.length
      });
    };

    var request = new XMLHttpRequest();
    switch (type) {
      case 'xml':
        request.overrideMimeType('text/xml');
        break;
      case 'text':
        break;
      default:
        throw new Error('Unknown type ' + type);
    }
    request.addEventListener('load', handleLoad);
    request.addEventListener('error', reject);
    request.open('GET', url);
    request.send();
  });
};

/**
 * Loads text from url.
 * @param {string} url
 * @return {Promise.<string>}
 */
var requestText = function(url) {
  return request(url, 'text');
};

/**
 * Loads text from url.
 * @param {string} url
 * @return {Promise.<string>}
 */
var requestXml = function(url) {
  return request(url, 'xml');
};

module.exports = {
  requestHeaders: requestHeaders,
  requestText: requestText,
  requestXml: requestXml
};

},{}],9:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

/**
 * Get filename of path or url.
 * @param {string} pathOrUrl
 * @return {string}
 */
var filename = function(pathOrUrl) {
  var lastSlashPosition = pathOrUrl.lastIndexOf('/');

  return lastSlashPosition === -1 ?
      pathOrUrl :
      pathOrUrl.slice(lastSlashPosition + 1);
};

/**
 * Get folder of path or url.
 * @param {string} pathOrUrl
 * @return {string}
 */
var folder = function(pathOrUrl) {
  var lastSlashPosition = pathOrUrl.lastIndexOf('/');

  return lastSlashPosition === -1 ?
      '' :
      pathOrUrl.slice(0, lastSlashPosition + 1);
};

/**
 * Join two paths.
 * @param {string} path1
 * @param {string} path2
 */
var combine = function(path1, path2) {
  if (!path1) {
    return path2;
  }
  if (!path2) {
    return path1;
  }

  return path1.replace(/\/+$/, '') + '/' + path2.replace(/^\/+/, '');
};

/**
 * Normalize path, remove double '//', and resolve '..' and '.'.
 * @param {string} path
 * @return {string}
 */
var normalize = function(path) {
  var segments = [];

  path.replace(/\/\/+/, '/').split('/')
      .forEach(function(segment) {
        if (segment === '.') {
          return;
        }

        if (segment === '..' && segments.length > 0 &&
            segments[segments.length - 1] !== '..') {
          segments.pop();
          return;
        }

        segments.push(segment);
      });
  return segments.join('/');
};

/**
 * Resolve relative path against base path.
 * @param {string} base
 * @param {string} path
 * @return {string}
 */
var resolve = function(base, path) {
  return path[0] === '/' ?
      normalize(path) : normalize(combine(base, path));
};

// Exports.
module.exports = {
  combine: combine,
  filename: filename,
  folder: folder,
  normalize: normalize,
  resolve: resolve
};

},{}],10:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

/**
 * Renderer cursor.
 * @param {!Element} container
 * @extends {Renderer}
 * @constructor
 */
function ReaderCursor(nextFunction) {
  this.nextFunction_ = nextFunction;
}

/**
 * Return next html element.
 * @return {Promise.<{value: HTMLElement, prerender: Array.<HTMLElement>}>}
 * @abstract
 */
ReaderCursor.prototype.next = function() {
  return this.nextFunction_.call(null);
};

/**
 * Close cursor.
 * @return {Promise.<void>}
 * @abstract
 */
ReaderCursor.prototype.close = function() {
  this.nextFunction_ = function() { return null; };
  return Promise.resolve();
};

// Exports.
module.exports = ReaderCursor;

},{}],11:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

/**
 * Normalize text spaces and newlines.
 * @param {string} text
 * @return {string}
 */
var normalizeText = function(text) {
  return text
      .replace(/^\s+|\s+$/g, '')
      .replace(/[^\S\n]+/g, ' ')
      .replace(/[^\S\n]+\n[^\S\n]+/g, '\n')
      .replace(/[^\S\n]+\n|\n[^\S\n]+/g, '\n')
      .replace(/\n\n+/g, '\n');
};

/**
 * Remove newlines from text.
 * @param {string} text
 * @return {string}
 */
var stripNewlines = function(text) {
  return text
      .replace(/^\n+|\n+$/g, '')
      .replace(/\n+/g, ' ');
};

module.exports = {
  stripNewlines: stripNewlines,
  normalizeText: normalizeText
};

},{}],12:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

/**
 * Depends on external zip library.
 */

'use strict';

// Dependencies.
var core = require('./core');
var zip = window.zip;

/**
 * Http reader for zip library.
 * @param {string} url
 * @constructor
 */
function HttpReader(url) {
  this.url_ = url;
}
core.extend(HttpReader, zip.Reader);

/**
 * Init reader.
 * @param {function} callback
 * @param {function} onerror
 */
HttpReader.prototype.init = function(callback, onerror) {
  var that = this;

  var request = new XMLHttpRequest();
  request.addEventListener('load', function() {
    var contentLengthHeader = request.getResponseHeader('Content-Length');
    that.data = new Uint8Array(request.response);
    that.size = contentLengthHeader ?
        parseInt(contentLengthHeader, 10) :
        that.data.length;

    callback();
  });
  request.addEventListener('error', onerror);
  request.open('GET', this.url_);
  request.responseType = 'arraybuffer';
  request.send();
};

/**
 * Get specified data part.
 * @param {number} index
 * @param {number} length
 * @param {function} callback
 */
HttpReader.prototype.readUint8Array = function(index, length, callback) {
  callback(new Uint8Array(this.data.subarray(index, index + length)));
};


/**
 * Book archive opener.
 * @param {zip.Reader} zipReader
 * @param {Array} entries
 * @param {number} streamSize
 * @constructor
 */
var Unarchiver = function(zipReader, entries, streamSize) {
  var that = this;
  this.zipReader_ = zipReader;
  this.streamSize_ = streamSize;

  this.entries_ = Object.create(null);
  entries.forEach(function(entry) {
    that.entries_[entry.filename] = entry;
  });
};

/**
 * Get stream size.
 * @return {number}
 */
Unarchiver.prototype.getStreamSize = function() {
  return this.streamSize_;
};

/**
 * Get stream size.
 * @return {Promise.<Array<string>>}
 */
Unarchiver.prototype.getEntries = function() {
  return Promise.resolve(Object.keys(this.entries_));
};

/**
 * Find zip archive entry.
 * @return {zip.Entry}
 * @private
 */
Unarchiver.prototype.findEntry_ = function(path) {
  return this.entries_[path] || null;
};

/**
 * Create blob url for provided path.
 * @param {string} path
 * @return {Promise.<Blob>}
 */
Unarchiver.prototype.createFileBlob = function(path) {
  var entry = this.findEntry_(path);
  if (!entry) {
    return Promise.reject('Can not find entry with path ' + path);
  }

  return new Promise(function(resolve) {
    var mimeType = zip.getMimeType(path);
    entry.getData(new zip.BlobWriter(mimeType), resolve, null, null);
  });
};

/**
 * Get text of file with provided encoding.
 * @param {string} path
 * @param {string} encoding
 * @return {Promise.<Text>}
 * @private
 */
Unarchiver.prototype.getTextWithEncoding_ = function(path, encoding) {
  var entry = this.findEntry_(path);
  if (!entry) {
    return Promise.reject('Can not find entry with path ' + path);
  }

  return new Promise(function(resolve) {
    entry.getData(new zip.TextWriter(encoding), resolve, null, null);
  });
};

/**
 * Get text of file, trying to detect encoding.
 * @param {string} path
 * @return {Promise.<string>}
 */
Unarchiver.prototype.getText = function(path) {
  var that = this;
  var defaultEncoding = 'utf-8';

  return this.getTextWithEncoding_(path, defaultEncoding)
      .then(function(text) {
        var textHeader = text.substring(0, 50);

        var encodingMatch = textHeader.match(/encoding=['"]+(.+)['"]+/);
        if (!encodingMatch) {
          return text;
        }

        var realEncoding = encodingMatch[1].toLowerCase();
        if (realEncoding === defaultEncoding) {
          return text;
        }

        return that.getTextWithEncoding_(path, realEncoding);
      });
};

/**
 * Get XML of file.
 * @param {string} path
 * @return {Promise.<Document>}
 */
Unarchiver.prototype.getXml = function(path) {
  return this.getText(path)
      .then(function(text) {
        var parser = new DOMParser();
        return parser.parseFromString(text, 'application/xml');
      });
};

/**
 * Get HTML of file.
 * @param {string} path
 * @return {Promise.<Document>}
 */
Unarchiver.prototype.getHtml = function(path) {
  return this.getText(path)
      .then(function(text) {
        var parser = new DOMParser();
        var xmlDocument = parser.parseFromString(text, 'application/xhtml+xml');
        if (xmlDocument.documentElement.querySelector(':root > parsererror')) {
          // fallback to html parser
          return parser.parseFromString(text, 'text/html');
        }

        return parser.parseFromString(
            xmlDocument.documentElement.innerHTML, 'text/html');
      });
};

/**
 * Destroy unarchiver object and free all internal resources.
 */
Unarchiver.prototype.dispose = function() {
  this.zipReader_.close();
  this.zipReader_ = null;
};

/**
 * Promise-style zipReader creation.
 * @param {string} streamUrl
 * @return {Promise}
 * @private
 */
function createZipReader_(streamUrl) {
  return new Promise(function(resolve, reject) {
    var httpReader = new HttpReader(streamUrl);
    zip.createReader(
        httpReader,
        function(zipReader) {
          zipReader.getEntries(function(entries) {
            resolve({
              zipReader: zipReader,
              entries: entries,
              streamSize: httpReader.size
            });
          });
        },
        reject);
  });
}

/**
 * Reads zip from url.
 * @param {string} streamUrl
 * @return {Promise.<Unarchiver>}
 * @static
 */
Unarchiver.openZipFromUrl = function(streamUrl) {
  return createZipReader_(streamUrl)
      .then(function(reader) {
        return new Unarchiver(
            reader.zipReader, reader.entries, reader.streamSize);
      });
};

// Exports.
module.exports = Unarchiver;

},{"./core":6}],13:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

/**
 * Return all elements matched provided xpath.
 * @param {!Document|!Element} element
 * @param {!Function} namespaceResolver
 * @param {string} xpath
 */
var getElementsByXpath = function(element, namespaceResolver, xpath) {
  var result = [];

  var isElementDocument = element instanceof HTMLDocument ||
      element instanceof XMLDocument;
  var document = isElementDocument ?
      element : element.ownerDocument;

  var resultElement;
  var resultIterator = document.evaluate(xpath, element,
      namespaceResolver, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
  while (resultElement = resultIterator.iterateNext()) {
    result.push(resultElement);
  }

  return result;
};

/**
 * Tries provided selectors one by one and return first not null element.
 * @param {!Element} element
 * @param {Array.<string>|string} selectors
 */
var getFirstMatchBySelector = function(element, selectors) {
  if (typeof selectors === 'string') {
    selectors = [selectors];
  }

  var i;
  for (i = 0; i < selectors.length; i++) {
    var result = element.querySelector(selectors[i]);
    if (result) {
      return result;
    }
  }

  return null;
};

/**
 * Tries provided xpaths one by one and return first not null element.
 * @param {!Document|!Element} element
 * @param {!Function} namespaceResolver
 * @param {Array.<string>|string} xpaths
 */
var getFirstMatchByXpath = function(element, namespaceResolver, xpaths) {

  var isElementDocument = element instanceof HTMLDocument ||
      element instanceof XMLDocument;
  var document = isElementDocument ?
      element : element.ownerDocument;

  if (typeof xpaths === 'string') {
    xpaths = [xpaths];
  }

  var i;
  for (i = 0; i < xpaths.length; i++) {
    var resultIterator = document.evaluate(xpaths[i], element,
        namespaceResolver, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
    var result = resultIterator.iterateNext();
    if (result) {
      return result;
    }
  }

  return null;
};

// Exports.
module.exports = {
  getElementsByXpath: getElementsByXpath,
  getFirstMatchBySelector: getFirstMatchBySelector,
  getFirstMatchByXpath: getFirstMatchByXpath
};

},{}],14:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

// Dependencies.
var ReaderCore = require('./reader_core/base/reader_core');
var EpubReaderCore = require('./reader_core/epub/epub_reader_core');
var Fb2ReaderCore = require('./reader_core/fb2/fb2_reader_core');
var httpUtils = require('./common/http_utils');

/**
 * Predefined epub paths.
 * @enum {string}
 */
var BookPackageTypes = {
  EpubZip: 'application/epub+zip',
  Fb2Zip: 'application/x-zip-compressed-fb2',
  Fb2Plain: 'application/x-fictionbook+xml'
};

/**
 * Create reader core.
 * @param {!Object} options
 * @return {Promise.<ReaderCore>}
 * @static
 */
var create = function(options) {
  if (!options.streamUrl) {
    return Promise.reject('options.streamUrl should be set.');
  }
  if (!options.container) {
    return Promise.reject('options.container should be set.');
  }

  var contentTypePromise = options.contentType ?
      Promise.resolve(options.contentType) :
      httpUtils.requestHeaders(options.streamUrl, ['content-type'])
          .then(function(headers) {
            return headers['content-type'] &&
                headers['content-type'].toLowerCase();
          });

  return contentTypePromise.then(function(contentType) {
    if (!contentType) {
      throw new Error('Content-type header for provided stream not found and ' +
          'contentType option value not provided');
    }
    switch (contentType) {
      case BookPackageTypes.EpubZip:
        return EpubReaderCore.create(options);
      case BookPackageTypes.Fb2Plain:
        return Fb2ReaderCore.createPlain(options);
      case BookPackageTypes.Fb2Zip:
        return Fb2ReaderCore.createZip(options);
      default:
        throw new Error('Unknown content-type ' + contentType);
    }
  });
};

// Exports.
module.exports = {
  create: create,
  RenderMode: ReaderCore.RenderMode,
};

},{"./common/http_utils":8,"./reader_core/base/reader_core":37,"./reader_core/epub/epub_reader_core":40,"./reader_core/fb2/fb2_reader_core":42}],15:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

/**
 * Book package.
 * @constructor
 */
var BookDocument = function() {

};

/**
 * Return document html.
 * @return {Promise.<Document>}
 * @abstract
 */
BookDocument.prototype.getDocumentHtml = function() {
  throw new Error('Method not implemented');
};

// Exports.
module.exports = BookDocument;

},{}],16:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

/**
 * Book package.
 * @constructor
 */
var BookPackage = function() {
};

/**
 * Return book metadata.
 * @return {Promise.<Metadata>}
 * @abstract
 */
BookPackage.prototype.getMetadata = function() {
  throw new Error('Method not implemented');
};

/**
 * Return book ToC tree.
 * @return {Promise.<TocTree>}
 * @abstract
 */
BookPackage.prototype.getTocTree = function() {
  throw new Error('Method not implemented');
};

/**
 * Return book stream size.
 * @abstract
 * @return {number}
 */
BookPackage.prototype.getStreamSize = function() {
  throw new Error('Method not implemented');
};

/**
 * Destroy book package object and free all internal resources.
 * @virtual
 */
BookPackage.prototype.dispose = function() {

};

// Exports.
module.exports = BookPackage;

},{}],17:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

/**
 * Book metadata.
 * @constructor
 */
function Metadata() {
  this.bookTitle_ = '';
  this.creator_ = '';
  this.description_ = '';
  this.publisher_ = '';
  this.year_ = '';
}

/**
 * Book title.
 * @return {string}
 */
Metadata.prototype.getBookTitle = function() {
  return this.bookTitle_;
};

/**
 * Book author.
 * @return {string}
 */
Metadata.prototype.getCreator = function() {
  return this.creator_;
};

/**
 * Book description.
 * @return {string}
 */
Metadata.prototype.getDescription = function() {
  return this.description_;
};

/**
 * Book publisher.
 * @return {string}
 */
Metadata.prototype.getPublisher = function() {
  return this.publisher_;
};

/**
 * Book publish year.
 * @return {string}
 */
Metadata.prototype.getYear = function() {
  return this.year_;
};

// Exports.
module.exports = Metadata;

},{}],18:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

/**
 * Book toc tree.
 * @constructor
 */
function TocTree() {
  this.children_ = [];
}

/**
 * Item child elements.
 * @return {Array.<TocTreeItem>}
 */
TocTree.prototype.getChildren = function() {
  return this.children_;
};

// Exports.
module.exports = TocTree;

},{}],19:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

/**
 * Book toc tree item.
 * @param {!string} title
 * @param {!string} href
 * @param {!Array.<TocTreeItem>} childItems
 * @constructor
 */
function TocTreeItem(title, href, childItems) {
  var that = this;

  this.title_ = title;
  this.href_ = href;
  that.children_ = [];
  childItems.forEach(function(childItem) {
    that.children_.push(childItem);
  });
}

/**
 * Item href.
 * @return {string}
 */
TocTreeItem.prototype.getHref = function() {
  return this.href_;
};

/**
 * Item title.
 * @return {string}
 */
TocTreeItem.prototype.getTitle = function() {
  return this.title_;
};

/**
 * Item child elements.
 * @return {Array.<TocTreeItem>}
 */
TocTreeItem.prototype.getChildren = function() {
  return this.children_;
};

// Exports.
module.exports = TocTreeItem;

},{}],20:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

// Dependencies.
var BookDocument = require('../base/book_document');
var CfiBuilder = require('../../common/cfi_builder');
var core = require('../../common/core');
var paths = require('../../common/paths');

/**
 * @type {string}
 */
var CFI_ATTRIBUTE = 'reader-parser--cfi';

/**
 * Tags not allowed in book document.
 * @type {Array.<String>}
 */
var TAG_BLACKLIST = [
  'object', 'script'
];

/**
 * Attributes allowed in book documents.
 * @type {Array.<String>}
 */
var ATTRIBUTE_WHITELIST = [
  'alt', 'class', 'content', 'href', 'height', 'id', 'name',
  'preserveaspectratio', 'rel', 'src', 'style', 'target', 'viewbox',
  'title', 'width', 'xlink:href'
];

/**
 * Epub manifest item.
 * @param {EpubManifestItem} manifestItem
 * @param {boolean} linear
 * @param {string} cfi
 * @param {EpubResourceLoader} resourceLoader
 * @extends {BookDocument}
 * @constructor
 */
function EpubChapter(manifestItem, linear, cfi, resourceLoader) {
  EpubChapter.superclass.constructor.apply(this);

  this.manifestItem_ = manifestItem;
  this.linear_ = linear;
  this.cfi_ = cfi;
  this.resourceLoader_ = resourceLoader;
  this.documentHtml_ = null;
}
core.extend(EpubChapter, BookDocument);

/**
 * @return {EpubManifestItem}
 */
EpubChapter.prototype.getManifestItem = function() {
  return this.manifestItem_;
};

/**
 * @return {boolean}
 */
EpubChapter.prototype.getLinear = function() {
  return this.linear_;
};

/**
 * @return {string}
 */
EpubChapter.prototype.getCfi = function() {
  return this.cfi_;
};

/**
 * Return document html.
 * @return {Promise.<Document>}
 * @override
 */
EpubChapter.prototype.getDocumentHtml = function() {
  var that = this;
  if (that.documentHtml_) {
    return Promise.resolve(that.documentHtml_);
  }

  var documentHtmlPath = this.getManifestItem().getHref();
  var folder = paths.folder(documentHtmlPath);

  return this.resourceLoader_
      .getHtml(documentHtmlPath)
      .then(function(htmlContent) {
        return that.transformDocument_(htmlContent);
      }).then(function(htmlContent) {
        return that.replaceImageSrc_(folder, htmlContent);
      }).then(function(htmlContent) {
        return that.replaceSvgHref_(folder, htmlContent);
      }).then(function(htmlContent) {
        return that.replaceStylesheets_(folder, htmlContent);
      }).then(function(htmlContent) {
        that.documentHtml_ = htmlContent;
        return htmlContent;
      });
};

/**
 * Regexp to check if node is empty.
 * @type {RegExp}
 */
var emptyTextRegex = /^\s+$/;

/**
 * @param {HTMLElement} node
 * @private
 */
EpubChapter.prototype.removeBlacklistedAttributes_ = function(node) {
  var j;
  var attributes = Array.prototype.slice.call(node.attributes);
  for (j = 0; j < attributes.length; j++) {
    var attributeName = attributes[j].name;
    if (ATTRIBUTE_WHITELIST.indexOf(attributeName.toLowerCase()) === -1) {
      node.removeAttribute(attributeName);
    }
  }
};

EpubChapter.prototype.transformTextNode_ = function(node, cfiBuilder) {
  var textContent = node.textContent;
  if (textContent !== '\n' && !emptyTextRegex.test(textContent)) {
    var spanNode = node.ownerDocument.createElement('span');
    spanNode.setAttribute(CFI_ATTRIBUTE, cfiBuilder.toString());
    spanNode.textContent = textContent;
    node.parentNode.replaceChild(spanNode, node);
  }
};

EpubChapter.prototype.transformElement_ = function(element, cfiBuilder) {
  if (TAG_BLACKLIST.indexOf(element.tagName.toLowerCase()) !== -1) {
    element.parentNode.removeChild(element);
  } else {
    this.removeBlacklistedAttributes_(element);
    element.setAttribute(CFI_ATTRIBUTE, cfiBuilder.toString());
    this.transformElementChildren_(element, cfiBuilder);
  }
};

/**
 * @param {HTMLElement} node
 * @param {CfiBuilder} cfiBuilder
 * @private
 */
EpubChapter.prototype.transformElementChildren_ = function(node, cfiBuilder) {
  var children = Array.prototype.slice.call(node.childNodes);
  if (children.length === 0 ||
      (children.length === 1 && children[0].nodeType === Node.TEXT_NODE)) {
    return;
  }

  cfiBuilder.enterChild();

  var i;
  var previousNodeType = null;
  for (i = 0; i < children.length; i++) {
    var childNode = children[i];
    if (childNode.nodeType !== Node.ELEMENT_NODE &&
        childNode.nodeType !== Node.TEXT_NODE) {
      node.removeChild(childNode);
    } else if (childNode.nodeType === Node.TEXT_NODE) {
      this.transformTextNode_(childNode, cfiBuilder);
    } else {
      if (previousNodeType !== Node.TEXT_NODE) {
        cfiBuilder.nextSibling();
      }
      this.transformElement_(childNode, cfiBuilder);
    }

    previousNodeType = childNode.nodeType;
    cfiBuilder.nextSibling();
  }

  cfiBuilder.leaveChild();
};

/**
 * Remove blacklisted tags and attributes from document, wrap text nodes and
 * save elements cfi.
 * @param {!Document} htmlContent
 * @return {Document}
 * @private
 * @static
 */
EpubChapter.prototype.transformDocument_ = function(htmlContent) {
  this.transformElementChildren_(htmlContent.documentElement, new CfiBuilder());
  return htmlContent;
};

/**
 * Replace addresses of images from paths relative to current document in
 * epub zip archive to blob urls. Call file loader to create blob urls
 * from archive data.
 * @param {string} folder
 * @param {!Document} htmlContent
 * @return {Promise.<Document>}
 * @private
 */
EpubChapter.prototype.replaceImageSrc_ = function(folder, htmlContent) {
  var that = this;
  return this.replaceResourcesLinks_(
      htmlContent, folder,
      'img[src]', 'src',
      function(path) {
        return that.resourceLoader_.createFileBlobUrl(path);
      });
};

/**
 * Do same as {@link replaceImageSrc_} but for svg hrefs.
 * @param {string} folder
 * @param {!Document} htmlContent
 * @return {Promise.<Document>}
 * @private
 */
EpubChapter.prototype.replaceSvgHref_ = function(folder, htmlContent) {
  var that = this;
  return this.replaceResourcesLinks_(
      htmlContent, folder,
      'image', 'xlink:href',
      function(path) {
        return that.resourceLoader_.createFileBlobUrl(path);
      });
};

/**
 * Replace addresses of stylesheets, relative to document in zip archive
 * to blob urls. (Same as {@link replaceImageSrc_}) Parse CSS code and
 * replace all paths in CSS text too.
 * @param {string} folder
 * @param {!Document} htmlContent
 * @return {Promise.<Document>}
 * @private
 */
EpubChapter.prototype.replaceStylesheets_ = function(folder, htmlContent) {
  var that = this;
  return this.replaceResourcesLinks_(
      htmlContent,
      folder,
      'link[href][rel="stylesheet"]',
      'href',
      function(path) {
        return that.resourceLoader_.createCssBlobUrl(path);
      });
};

/**
 * Util function. Finds all resources using selector, then take resource
 * path using path attribute and replace path with blob url, witch is
 * provided with processResourceFunction function. Caches results of process
 * function.
 * @param {!Document} htmlContent
 * @param {string} folder
 * @param {string} selector
 * @param {string} attribute
 * @param {function} processResourceFunction
 * @return {Promise.<Document>}
 * @private
 */
EpubChapter.prototype.replaceResourcesLinks_ = function(htmlContent, folder,
    selector, attribute, processResourceFunction) {
  var elements = htmlContent.querySelectorAll(selector);

  var elementsToProcess = Array.prototype
      .slice.call(elements)
      .filter(function(element) {
        return element.hasAttribute(attribute);
      });

  var promises = elementsToProcess.map(function(element) {
    var relativePath = element.getAttribute(attribute) || '';
    var absolutePath = paths.resolve(folder, relativePath);

    return Promise.resolve()
        .then(function() {
          // We don't call processResourceFunction.then() directly because
          // processResourceFunction can remove promise or value itself.
          return processResourceFunction(absolutePath);
        })
        .catch(function() {
          return '';
        })
        .then(function(blobPath) {
          element.setAttribute(attribute, blobPath);
        });
  });

  return Promise.all(promises)
      .then(function() {
        return htmlContent;
      });
};

// Exports.
module.exports = EpubChapter;

},{"../../common/cfi_builder":4,"../../common/core":6,"../../common/paths":9,"../base/book_document":15}],21:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

// Dependencies.
var Cfi = require('../../common/cfi');
var CfiBuilder = require('../../common/cfi_builder');
var EpubChapter = require('./epub_chapter');
var xmlNamespaces = require('./epub_xml_namespaces');
var xmlUtils = require('../../common/xml_utils');

/**
 * Epub book metadata.
 * @param {!Document} packageXml
 * @param {!EpubManifest} manifest
 * @param {!EpubResourceLoader} resourceLoader
 * @constructor
 */
function EpubChapters (packageXml, manifest, resourceLoader) {
  var that = this;
  var spineElement = xmlUtils.getFirstMatchByXpath(
      packageXml, xmlNamespaces.opf, '/opf:package/opf:spine');

  var includedItemrefs = Object.create(null);
  that.chapters_ = [];
  var cfiBuilder = new CfiBuilder(Cfi.getElementCfi(spineElement));
  cfiBuilder.enterChild();
  cfiBuilder.nextSibling();
  var i;
  for (i = 0; i < spineElement.childElementCount; i++) {
    var childElement = spineElement.children[i];
    if (childElement.tagName.toLowerCase() === 'itemref') {
      var idref = childElement.getAttribute('idref');
      var linear = childElement.getAttribute('linear') !== 'no';
      var manifestItem = manifest.getContentDocumentItemById(idref);
      var chapter = new EpubChapter(
          manifestItem,
          linear,
          cfiBuilder.toString(),
          resourceLoader);
      includedItemrefs[manifestItem.getId()] = true;
      that.chapters_.push(chapter);
    }

    cfiBuilder.nextSibling();
    cfiBuilder.nextSibling();
  }

  // According to specifications, we have to add all items with OPS Document
  // media types witch are not listed in spine to internal reader spine list
  // with linear='no'.
  manifest
      .getContentDocuments()
      .filter(function(manifestItem) {
        return !Object.prototype.hasOwnProperty
            .call(includedItemrefs, manifestItem.getId());
      })
      .forEach(function(manifestItem) {
        var chapter = new EpubChapter(
            manifestItem,
            false,
            manifestItem.getCfi(),
            resourceLoader);
        that.chapters_.push(chapter);
      });
}

/**
 * Return chapters count.
 * @return {number}
 */
EpubChapters.prototype.getChaptersCount = function() {
  return this.chapters_.length;
};

/**
 * Return chapter item by id.
 * @param {number} index
 * @return {EpubChapter}
 */
EpubChapters.prototype.getByIndex = function(index) {
  return this.chapters_[index] || null;
};

/**
 * Return chapter index.
 * @param {!EpubChapter} chapter
 * @return {number}
 */
EpubChapters.prototype.getChapterIndex = function(chapter) {
  return this.chapters_.indexOf(chapter);
};

/**
 * Return chapter by cfi.
 * @param {string} cfi
 * @return {EpubChapter}
 */
EpubChapters.prototype.getByCfi = function(cfi) {
  var i;
  for (i = 0; i < this.chapters_.length; i++) {
    var chapter = this.chapters_[i];
    if (chapter.getCfi() === cfi) {
      return chapter;
    }
  }

  return null;
};

/**
 * Return chapter by path.
 * @param {string} path
 * @return {EpubChapter}
 */
EpubChapters.prototype.getByPath = function(path) {
  var i;
  path = path.toLowerCase();
  for (i = 0; i < this.chapters_.length; i++) {
    var chapter = this.chapters_[i];
    if (chapter.getManifestItem().getHref().toLowerCase() === path) {
      return chapter;
    }
  }

  return null;
};

/**
 * Get first linear='yes' chapter.
 * @return {EpubChapter}
 */
EpubChapters.prototype.getFirstLinear = function() {
  return this.getNextLinearByIndex(-1);
};

/**
 * Get next to provided index linear='yes' chapter.
 * @param {number} searchFromIndex
 * @return {EpubChapter}
 */
EpubChapters.prototype.getNextLinearByIndex = function(searchFromIndex) {
  for (var i = searchFromIndex + 1; i < this.chapters_.length; i++) {
    var chapter = this.chapters_[i];
    if (chapter.getLinear()) {
      return chapter;
    }
  }

  return null;
};

/**
 * Get prev to provided index linear='yes' chapter.
 * @param {number} searchFromIndex
 * @return {EpubChapter}
 */
EpubChapters.prototype.getPrevLinearByIndex = function(searchFromIndex) {
  for (var i = searchFromIndex - 1; i >= 0; i--) {
    var chapter = this.chapters_[i];
    if (chapter.getLinear()) {
      return chapter;
    }
  }

  return null;
};

/**
 * Get prev to provided index linear='yes' spine element.
 * @param {EpubChapter} searchFromChapter
 * @return {EpubChapter}
 */
EpubChapters.prototype.getNextLinearByChapter = function(searchFromChapter) {
  var index = this.getChapterIndex(searchFromChapter);
  if (index === -1) {
    throw new Error('Provided chapter not found in chapters');
  }

  return this.getNextLinearByIndex(index);
};

/**
 * Get prev to provided index linear='yes' spine element.
 * @param {EpubChapter} searchFromChapter
 * @return {EpubChapter}
 */
EpubChapters.prototype.getPrevLinearByChapter = function(searchFromChapter) {
  var index = this.getChapterIndex(searchFromChapter);
  if (index === -1) {
    throw new Error('Provided chapter not found in chapters');
  }

  return this.getPrevLinearByIndex(index);
};

// Exports.
module.exports = EpubChapters;

},{"../../common/cfi":3,"../../common/cfi_builder":4,"../../common/xml_utils":13,"./epub_chapter":20,"./epub_xml_namespaces":28}],22:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

// Dependencies.
var Cfi = require('../../common/cfi');
var CfiBuilder = require('../../common/cfi_builder');
var EpubManifestItem = require('./epub_manifest_item');
var xmlNamespaces = require('./epub_xml_namespaces');
var xmlUtils = require('../../common/xml_utils');

/**
 * Epub book metadata.
 * @param {!Document} packageXml
 * @constructor
 */
function EpubManifest (packageXml) {
  var that = this;
  var manifestElement = xmlUtils.getFirstMatchByXpath(
      packageXml, xmlNamespaces.opf, '/opf:package/opf:manifest');

  that.items_ = Object.create(null);
  var cfiBuilder = new CfiBuilder(Cfi.getElementCfi(manifestElement));
  cfiBuilder.enterChild();
  cfiBuilder.nextSibling();
  var i;
  for (i = 0; i < manifestElement.childElementCount; i++) {
    var childElement = manifestElement.children[i];
    if (childElement.tagName.toLowerCase() === 'item') {
      var id = childElement.getAttribute('id');
      that.items_[id] = new EpubManifestItem(
          id,
          childElement.getAttribute('href'),
          childElement.getAttribute('media-type'),
          childElement.getAttribute('fallback'),
          cfiBuilder.toString());
    }

    cfiBuilder.nextSibling();
    cfiBuilder.nextSibling();
  }
}

/**
 * Return manifest item by id.
 * @param {string} id
 */
EpubManifest.prototype.getItemById = function(id) {
  return this.items_[id] || null;
};

/**
 * Return manifest item by id. Returns only OPS Content documents, using
 * fallback chain.
 * @param {string} id
 */
EpubManifest.prototype.getContentDocumentItemById = function(id) {
  var item = this.items_[id];
  if (!item) {
    return null;
  }

  return item.isContentDocument() ?
      item : this.getContentDocumentItemById(item.getFallback());
};

/**
 * Return all items, witch are OPS Content Documents.
 */
EpubManifest.prototype.getContentDocuments = function() {
  var that = this;
  return Object.keys(this.items_)
      .filter(function(key) {
        return that.items_[key].isContentDocument();
      })
      .map(function(key) {
        return that.items_[key];
      });
};

// Exports.
module.exports = EpubManifest;

},{"../../common/cfi":3,"../../common/cfi_builder":4,"../../common/xml_utils":13,"./epub_manifest_item":23,"./epub_xml_namespaces":28}],23:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

/**
 * Media types of allowed OPS Content Document.
 * @type {Array.<string>}
 */
var ContentDocumentMediaTypes = [
  'application/xhtml+xml',
  'application/x-dtbook+xml',
  'text/x-oeb1-document'
];

/**
 * Epub manifest item.
 * @param {string} id
 * @param {string} href
 * @param {string} mediaType
 * @param {string} fallback
 * @param {string} cfi
 * @constructor
 */
function EpubManifestItem(id, href, mediaType, fallback, cfi) {
  this.id_ = id;
  this.href_ = href;
  this.mediaType_ = mediaType;
  this.fallback_ = fallback;
  this.cfi_ = cfi;
}

/**
 * @return {string}
 */
EpubManifestItem.prototype.getId = function() {
  return this.id_;
};

/**
 * @return {string}
 */
EpubManifestItem.prototype.getHref = function() {
  return this.href_;
};

/**
 * @return {string}
 */
EpubManifestItem.prototype.getFallback = function() {
  return this.fallback_;
};

/**
 * @return {string}
 */
EpubManifestItem.prototype.getCfi = function() {
  return this.cfi_;
};

/**
 * @return {boolean}
 */
EpubManifestItem.prototype.isContentDocument = function() {
  var mediaType = this.mediaType_ ? this.mediaType_.toLowerCase() : '';
  return ContentDocumentMediaTypes.indexOf(mediaType) !== -1;
};

// Exports.
module.exports = EpubManifestItem;

},{}],24:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

// Dependencies.
var core = require('../../common/core');
var Metadata = require('../base/metadata');
var textUtils = require('../../common/text_utils');
var xmlNamespaces = require('./epub_xml_namespaces');
var xmlUtils = require('../../common/xml_utils');

/**
 * Get metadata element text value.
 * @param {!Document} packageXml
 * @param {Array.<string>|string} xpath
 * @return {string}
 */
function getMetadataTextByXpath(packageXml, xpath) {
  var metadata = xmlUtils.getFirstMatchByXpath(
      packageXml, xmlNamespaces.opf, '/opf:package/opf:metadata');
  if (!metadata) {
    return '';
  }

  var element = xmlUtils.getFirstMatchByXpath(
      metadata, xmlNamespaces.opf, xpath);

  return !element ? '' : textUtils.normalizeText(element.textContent);
}

/**
 * Epub book metadata.
 * @param {!Document} packageXml
 * @extends {Metadata}
 * @constructor
 */
function EpubMetadata (packageXml) {
  EpubMetadata.superclass.constructor.apply(this);

  this.publisher_ = getMetadataTextByXpath(packageXml, 'dc:publisher');
  var date = getMetadataTextByXpath(packageXml, 'dc:date');
  var dateParse = /(\d{4})(-\d{2}(-\d{2})?)?/.exec(date);
  this.year_ = dateParse ? dateParse[1] : '';
  this.bookTitle_ = getMetadataTextByXpath(packageXml, 'dc:title');
  this.creator_ = getMetadataTextByXpath(
      packageXml, ['dc:creator[@opf:role="aut"]', 'dc:creator']);
  this.description_ = getMetadataTextByXpath(packageXml, 'dc:description');
}
core.extend(EpubMetadata, Metadata);

// Exports.
module.exports = EpubMetadata;

},{"../../common/core":6,"../../common/text_utils":11,"../../common/xml_utils":13,"../base/metadata":17,"./epub_xml_namespaces":28}],25:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

// Dependencies.
var BookPackage = require('../base/book_package');
var core = require('../../common/core');
var EpubChapters = require('./epub_chapters');
var EpubManifest = require('./epub_manifest');
var EpubMetadata = require('./epub_metadata');
var EpubResourceLoader = require('./epub_resource_loader');
var EpubTocTree = require('./epub_toc_tree');
var paths = require('../../common/paths');
var Unarchiver = require('../../common/unarchiver');
var xmlNamespaces = require('./epub_xml_namespaces');
var xmlUtils = require('../../common/xml_utils');

/**
 * Predefined epub paths.
 * @enum {string}
 */
var EpubPredefinedPaths = {
  CONTAINER: 'META-INF/container.xml'
};

/**
 * Epub package.
 * @param {!EpubResourceLoader} resourceLoader
 * @param {!Document} packageXml
 * @extends {BookPackage}
 * @constructor
 */
var EpubPackage = function(resourceLoader, packageXml) {
  EpubPackage.superclass.constructor.call(this);

  this.resourceLoader_ = resourceLoader;

  this.metadata_ = new EpubMetadata(packageXml);
  this.manifest_ = new EpubManifest(packageXml);
  this.chapters_ = new EpubChapters(
      packageXml, this.manifest_, this.resourceLoader_);

  var spineElement = xmlUtils.getFirstMatchByXpath(
      packageXml, xmlNamespaces.opf, '/opf:package/opf:spine');
  this.tocManifestItemId_ = spineElement.getAttribute('toc');
};
core.extend(EpubPackage, BookPackage);

/**
 * @return {Promise.<EpubManifest>}
 * @private
 */
EpubPackage.prototype.getManifest_ = function() {
  return Promise.resolve(this.manifest_);
};

/**
 * @return {Promise.<EpubMetadata>}
 * @override
 */
EpubPackage.prototype.getMetadata = function() {
  return Promise.resolve(this.metadata_);
};

/**
 * @return {Promise.<EpubTocTree>}
 * @override
 */
EpubPackage.prototype.getTocTree = function() {
  var that = this;
  if (this.tocTree_) {
    return Promise.resolve(this.tocTree_);
  }

  var tocManifestItem = this.manifest_.getItemById(this.tocManifestItemId_);
  return this.resourceLoader_.getXml(tocManifestItem.getHref())
      .then(function(tocXml) {
        that.tocTree_ = new EpubTocTree(tocXml);
        return that.tocTree_;
      });
};

/**
 * @override
 * @return {number}
 */
EpubPackage.prototype.getStreamSize = function() {
  return this.resourceLoader_.getStreamSize();
};

/**
 * Return epub chapters.
 * @return {Promise.<EpubChapters>}
 */
EpubPackage.prototype.getChapters = function() {
  return Promise.resolve(this.chapters_);
};

/**
 * @override
 */
EpubPackage.prototype.dispose = function() {
  EpubPackage.superclass.dispose.call(this);

  this.resourceLoader_.dispose();

  this.resourceLoader_ = null;
  this.metadata_ = null;
  this.manifest_ = null;
  this.chapters_ = null;
};

/**
 * Get package file path from book archive.
 * @param {Unarchiver} unarchiver
 * @return {Promise.<string>}
 */
function getPackagePath(unarchiver) {
  return unarchiver
      .getXml(EpubPredefinedPaths.CONTAINER)
      .then(function(containerXml) {
        var rootFileElement = xmlUtils.getFirstMatchBySelector(containerXml, [
          'rootfile[media-type="application/oebps-package+xml"]',
          'rootfile[full-path$=".opf"]',
          'rootfile'
        ]);

        return rootFileElement.getAttribute('full-path');
      });
}

/**
 * Open book from provided url.
 * @param {string} streamUrl
 * @return {Promise.<EpubPackage>}
 * @static
 */
EpubPackage.openBookFromUrl = function(streamUrl) {
  var unarchiver;
  var packageLoader;

  return Unarchiver.openZipFromUrl(streamUrl).then(function(createdUnarchiver) {
    unarchiver = createdUnarchiver;
    return getPackagePath(unarchiver);
  }).then(function(packagePath) {
    var rootPath = paths.folder(packagePath);
    var packageFileName = paths.filename(packagePath);
    packageLoader = new EpubResourceLoader(unarchiver, rootPath);
    return packageLoader.getXml(packageFileName);
  }).then(function(packageXml) {
    return new EpubPackage(packageLoader, packageXml);
  });
};

// Exports.
module.exports = EpubPackage;

},{"../../common/core":6,"../../common/paths":9,"../../common/unarchiver":12,"../../common/xml_utils":13,"../base/book_package":16,"./epub_chapters":21,"./epub_manifest":22,"./epub_metadata":24,"./epub_resource_loader":26,"./epub_toc_tree":27,"./epub_xml_namespaces":28}],26:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

// Dependencies.
var asyncUtils = require('../../common/async_utils');
var paths = require('../../common/paths');

/**
 * Epub package file loader. Has interface close similar to
 * Unarchiver, but works with root path.
 * @constructor
 */
var EpubResourceLoader = function(unarchiver, rootPath) {
  this.unarchiver_ = unarchiver;
  this.rootPath_ = rootPath;

  this.resourceUrlCache_ = Object.create(null);
  this.cssUrlCache_ = Object.create(null);
};

/**
 * Get stream size.
 * @return {number}
 */
EpubResourceLoader.prototype.getStreamSize = function() {
  return this.unarchiver_.getStreamSize();
};

/**
 * Create blob url for provided path.
 * @param {string} path
 * @return {Promise.<string>}
 */
EpubResourceLoader.prototype.createFileBlob = function(path) {
  return this.unarchiver_.createFileBlob(paths.combine(this.rootPath_, path));
};

/**
 * Create blob url for provided path.
 * @param {string} path
 * @return {Promise.<string>}
 */
EpubResourceLoader.prototype.createFileBlobUrl = function(path) {
  var that = this;

  if (Object.prototype.hasOwnProperty.call(this.resourceUrlCache_, path)) {
    return Promise.resolve(this.resourceUrlCache_[path]);
  }

  return this.createFileBlob(path).then(function(blob) {
    var blobUrl = window.URL.createObjectURL(blob);
    that.resourceUrlCache_[path] = blobUrl;
    return blobUrl;
  });
};

/**
 * Preprocess css url() resources.
 * @param {string} folder
 * @param {string} cssText
 * @return {Promise.<string>}
 * @private
 */
EpubResourceLoader.prototype.preprocessCssText_ = function(folder, cssText) {
  var that = this;
  var urlRegex = /url\(('|")?([^'"]*)('|")?\)/mgi;
  var urlMatches = cssText.match(urlRegex)
      .filter(function(value, index, self) {
        return self.indexOf(value) === index;
      });

  return asyncUtils.asyncMap(urlMatches, function(urlMatch) {
    var resourceUrl = urlMatch.replace(/^url\(('|")?|('|")\)$/gi, '');
    return that
        .createFileBlobUrl(paths.resolve(folder, resourceUrl))
        .catch(function() {return '';})
        .then(function(blobUrl) {
          return {match: urlMatch, blobUrl: blobUrl};
        });
  }).then(function(processedUrls) {
    processedUrls.forEach(function(url) {
      cssText = cssText.replace(url.match, 'url("' + url.blobUrl + '")');
    });

    return cssText;
  });
};

/**
 * Create blob url for css for provided path, replacing resource urls.
 * @param {string} path
 */
EpubResourceLoader.prototype.createCssBlobUrl = function(path) {
  var that = this;

  if (Object.prototype.hasOwnProperty.call(this.cssUrlCache_, path)) {
    return Promise.resolve(this.cssUrlCache_[path]);
  }

  return this.getText(path).then(function(cssText) {
    return that.preprocessCssText_(paths.folder(path), cssText);
  }).then(function(preprocessedCssText) {
    var textBlob = new Blob([preprocessedCssText], {type: 'text/css'});
    var blobUrl = window.URL.createObjectURL(textBlob);
    that.cssUrlCache_[path] = blobUrl;
    return blobUrl;
  });

};

/**
 * Get text of file, trying to detect encoding.
 * @param {string} path
 * @return {Promise.<string>}
 */
EpubResourceLoader.prototype.getText = function(path) {
  return this.unarchiver_.getText(paths.combine(this.rootPath_, path));
};

/**
 * Get XML of file.
 * @param {string} path
 * @return {Promise.<Document>}
 */
EpubResourceLoader.prototype.getXml = function(path) {
  return this.unarchiver_.getXml(paths.combine(this.rootPath_, path));
};

/**
 * Get HTML of file.
 * @param {string} path
 * @return {Promise.<Document>}
 */
EpubResourceLoader.prototype.getHtml = function(path) {
  return this.unarchiver_.getHtml(paths.combine(this.rootPath_, path));
};

/**
 * Destroy resource loader object and free all internal resources.
 */
EpubResourceLoader.prototype.dispose = function() {
  var that = this;

  that.unarchiver_.dispose();
  Object.keys(that.resourceUrlCache_).forEach(function(key) {
    var url = that.resourceUrlCache_[key];
    window.URL.revokeObjectURL(url);
  });
  Object.keys(that.cssUrlCache_).forEach(function(key) {
    var url = that.cssUrlCache_[key];
    window.URL.revokeObjectURL(url);
  });

  that.unarchiver_ = null;
  that.resourceUrlCache_ = null;
  that.cssUrlCache_ = null;
};

// Exports.
module.exports = EpubResourceLoader;

},{"../../common/async_utils":1,"../../common/paths":9}],27:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

// Dependencies.
var core = require('../../common/core');
var TocTreeItem = require('../base/toc_tree_item');
var TocTree = require('../base/toc_tree');
var xmlNamespaces = require('./epub_xml_namespaces');
var xmlUtils = require('../../common/xml_utils');

/**
 * Create TocTreeItem from provided navPoint element.
 * @param {!Element} navPointElement
 * @return {TocTreeItem}
 */
var createItemFromNavPoint = function(navPointElement) {
  var navLabelElement = xmlUtils.getFirstMatchByXpath(
      navPointElement, xmlNamespaces.ncx, [
        'ncx:navLabel/ncx:text',
        'ncx:navLabel'
      ]);
  var contentElement = xmlUtils.getFirstMatchByXpath(
      navPointElement, xmlNamespaces.ncx, 'ncx:content');
  var childrenElements = xmlUtils.getElementsByXpath(
      navPointElement, xmlNamespaces.ncx, 'ncx:navPoint');

  var title = navLabelElement.textContent;
  var href = contentElement.getAttribute('src');
  var children = childrenElements.map(function(childElement) {
    return createItemFromNavPoint(childElement);
  });

  return new TocTreeItem(title, href, children);
};

/**
 * Book toc tree.
 * @param {!Document} tocXml
 * @extends {TocTree}
 * @constructor
 */
function EpubTocTree(tocXml) {
  EpubTocTree.superclass.constructor.apply(this);
  var that = this;

  var rootNavPointElements = xmlUtils.getElementsByXpath(
      tocXml, xmlNamespaces.ncx, '/ncx:ncx/ncx:navMap/ncx:navPoint');

  rootNavPointElements.forEach(function(navPointElement) {
    that.children_.push(createItemFromNavPoint(navPointElement));
  });
}
core.extend(EpubTocTree, TocTree);


// Exports.
module.exports = EpubTocTree;

},{"../../common/core":6,"../../common/xml_utils":13,"../base/toc_tree":18,"../base/toc_tree_item":19,"./epub_xml_namespaces":28}],28:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

/**
 * Namespace resolver for OPF xml document.
 * @param {string} prefix
 * @return {string}
 */
var opfNamespace = function(prefix) {
  var namespaces = {
    'dc' : 'http://purl.org/dc/elements/1.1/',
    'opf': 'http://www.idpf.org/2007/opf'
  };
  return namespaces[prefix] || null;
};

/**
 * Namespace resolver for NCX xml document.
 * @param {string} prefix
 * @return {string}
 */
var ncxNamespace = function(prefix) {
  var namespaces = {
    'ncx' : 'http://www.daisy.org/z3986/2005/ncx/'
  };
  return namespaces[prefix] || null;
};

// Exports.
module.exports = {
  opf: opfNamespace,
  ncx: ncxNamespace
};

},{}],29:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

// Dependencies.
var BookDocument = require('../base/book_document');
var core = require('../../common/core');
var documentTransform = require('./fb2_document_transform');

/**
 * Fb2 book document.
 * @param {!Document} bookXml
 * @extends {BookDocument}
 * @constructor
 */
function Fb2Document(bookXml) {
  Fb2Document.superclass.constructor.apply(this);

  var htmlContent = documentTransform.transformBook(bookXml);
  this.documentHtml_ = htmlContent;
}
core.extend(Fb2Document, BookDocument);

/**
 * Return document html.
 * @return {Promise.<Document>}
 * @override
 */
Fb2Document.prototype.getDocumentHtml = function() {
  return Promise.resolve(this.documentHtml_);
};

// Exports.
module.exports = Fb2Document;

},{"../../common/core":6,"../base/book_document":15,"./fb2_document_transform":30}],30:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

// Dependencies.
var CfiBuilder = require('../../common/cfi_builder');
var SectionNameBuilder = require('./fb2_section_name_builder');
var xmlNamespaces = require('./fb2_xml_namespaces');
var xmlUtils = require('../../common/xml_utils');

/**
 * @type {string}
 */
var CFI_ATTRIBUTE = 'reader-parser--cfi';

/**
 * @type {string}
 */
var SECTION_NAME_ATTRIBUTE = 'reader-parser--fb2-section-name';

/**
 * Append book element anchor to html.
 * @param {HTMLElement} htmlNode
 * @param {Element} xmlNode
 */
var appendAnchor = function(htmlNode, xmlNode) {
  var id = xmlNode.getAttribute('id');
  if (id) {
    var a = htmlNode.ownerDocument.createElement('a');
    a.name = id;
    htmlNode.appendChild(a);
  }
};

/**
 * Add current section anchor to html.
 * @param {!Object} state
 * @param {HTMLElement} htmlNode
 * @param {Element} xmlNode
 */
var appendSectionAnchor = function(state, htmlNode, xmlNode) {
  var a = htmlNode.ownerDocument.createElement('a');
  a.name = state.sectionNameBuilder.getSectionId();
  htmlNode.appendChild(a);
};

/**
 * Transform `a` xml node to html.
 * @param {!Object} state
 * @param {HTMLElement} htmlNode
 * @param {Element} xmlNode
 */
var transformANode = function(state, htmlNode, xmlNode) {
  var aElement = htmlNode.ownerDocument.createElement('a');
  aElement.href = xmlNode.getAttributeNS(xmlNamespaces.fb2('xlink'), 'href');
  aElement.setAttribute(CFI_ATTRIBUTE, state.cfiBuilder.toString());

  if (xmlNode.getAttribute('type') === 'note') {
    var supElement = htmlNode.ownerDocument.createElement('sup');
    transformChildNodes(state, supElement, xmlNode);
    aElement.appendChild(supElement);
  } else {
    transformChildNodes(state, aElement, xmlNode);
  }

  htmlNode.appendChild(aElement);
};

/**
 * Transform `body` xml node to html.
 * @param {!Object} state
 * @param {HTMLElement} htmlNode
 * @param {Element} xmlNode
 */
var transformBodyNode = function(state, htmlNode, xmlNode) {
  state.sectionNameBuilder.enterSection();

  var bodyElement = htmlNode.ownerDocument.createElement('div');
  bodyElement.classList.add('reader-parser--book-body');
  bodyElement.setAttribute(SECTION_NAME_ATTRIBUTE,
      state.sectionNameBuilder.getSectionId());
  bodyElement.setAttribute(CFI_ATTRIBUTE, state.cfiBuilder.toString());

  appendSectionAnchor(state, bodyElement, xmlNode);
  appendAnchor(bodyElement, xmlNode);

  var nameAttributeValue = xmlNode.getAttribute('name');
  if (nameAttributeValue) {
    var bodyTitleXmlNode = xmlUtils.getFirstMatchByXpath(
        xmlNode, xmlNamespaces.fb2, 'fb2:title');
    if (!bodyTitleXmlNode) {
      var headerElement = htmlNode.ownerDocument.createElement('h1');
      headerElement.classList.add('reader-parser--book-title');
      headerElement.textContent = nameAttributeValue;
      bodyElement.appendChild(headerElement);
    }
  }

  transformChildNodes(state, bodyElement, xmlNode);
  htmlNode.appendChild(bodyElement);

  state.sectionNameBuilder.leaveSection();
};

/**
 * Transform `cite` or `epigraph` or `poem` xml node to html.
 * @param {!Object} state
 * @param {HTMLElement} htmlNode
 * @param {Element} xmlNode
 */
var transformCiteOrEpigraphOrPoemNode = function(state, htmlNode, xmlNode) {
  var quoteElement = htmlNode.ownerDocument.createElement('blockquote');
  quoteElement.classList.add('reader-parser--' + xmlNode.tagName.toLowerCase());
  quoteElement.setAttribute(CFI_ATTRIBUTE, state.cfiBuilder.toString());

  appendAnchor(quoteElement, xmlNode);
  transformChildNodes(state, quoteElement, xmlNode);
  htmlNode.appendChild(quoteElement);
};

/**
 * Transform `code` xml node to html.
 * @param {!Object} state
 * @param {HTMLElement} htmlNode
 * @param {Element} xmlNode
 */
var transformCodeNode = function(state, htmlNode, xmlNode) {
  var element = htmlNode.ownerDocument.createElement('code');
  element.setAttribute(CFI_ATTRIBUTE, state.cfiBuilder.toString());

  transformChildNodes(state, element, xmlNode);
  htmlNode.appendChild(element);
}

/**
 * Transform `date` xml node to html.
 * @param {!Object} state
 * @param {HTMLElement} htmlNode
 * @param {Element} xmlNode
 */
var transformDateNode = function(state, htmlNode, xmlNode) {
  var spanElement = htmlNode.ownerDocument.createElement('span');
  spanElement.setAttribute(CFI_ATTRIBUTE, state.cfiBuilder.toString());

  var valueAttribute = xmlNode.getAttribute('value');
  if (valueAttribute) {
    spanElement.textContent = valueAttribute;
  } else {
    transformChildNodes(state, spanElement, xmlNode);
  }
  htmlNode.appendChild(spanElement);

  var brElement = htmlNode.ownerDocument.createElement('br');
  htmlNode.appendChild(brElement);
};

/**
 * Transform `description` xml node to html.
 * @param {!Object} state
 * @param {HTMLElement} htmlNode
 * @param {Element} xmlNode
 */
var transformDescriptionNode = function(state, htmlNode, xmlNode) {
  var divElement = htmlNode.ownerDocument.createElement('div');
  divElement.setAttribute(CFI_ATTRIBUTE, state.cfiBuilder.toString());

  state.cfiBuilder.enterChild();
  state.cfiBuilder.nextSibling();
  var descriptionChildElement;
  var i;
  for (i = 0; i < xmlNode.childElementCount; i++) {
    descriptionChildElement = xmlNode.children[i];
    if (descriptionChildElement.tagName.toLowerCase() === 'title-info') {
      transformTitleInfoNode(state, divElement, descriptionChildElement);
    }

    state.cfiBuilder.nextSibling();
    state.cfiBuilder.nextSibling();
  }
  state.cfiBuilder.leaveChild();

  htmlNode.appendChild(divElement);
};

/**
 * Transform `description` xml node to html.
 * @param {!Object} state
 * @param {HTMLElement} htmlNode
 * @param {Element} xmlNode
 */
var transformTitleInfoNode = function(state, htmlNode, xmlNode) {
  var divElement = htmlNode.ownerDocument.createElement('div');
  divElement.setAttribute(CFI_ATTRIBUTE, state.cfiBuilder.toString());

  state.cfiBuilder.enterChild();
  state.cfiBuilder.nextSibling();
  var coverpageContainer;
  var annotationContainer;
  var titleInfoChildElement;
  var i;
  for (i = 0; i < xmlNode.childElementCount; i++) {
    titleInfoChildElement = xmlNode.children[i];
    if (titleInfoChildElement.tagName.toLowerCase() === 'coverpage') {
      coverpageContainer = htmlNode.ownerDocument.createElement('div');
      coverpageContainer.setAttribute(
          CFI_ATTRIBUTE, state.cfiBuilder.toString());
      appendAnchor(titleInfoChildElement, coverpageContainer);
      transformChildNodes(state, coverpageContainer, titleInfoChildElement);
    }
    if (titleInfoChildElement.tagName.toLowerCase() === 'annotation') {
      annotationContainer = htmlNode.ownerDocument.createElement('div');
      annotationContainer.setAttribute(
          CFI_ATTRIBUTE, state.cfiBuilder.toString());
      appendAnchor(titleInfoChildElement, annotationContainer);
      transformChildNodes(state, annotationContainer, titleInfoChildElement);
    }

    state.cfiBuilder.nextSibling();
    state.cfiBuilder.nextSibling();
  }
  state.cfiBuilder.leaveChild();

  if (coverpageContainer) {
    divElement.appendChild(coverpageContainer);
  }

  if (annotationContainer) {
    divElement.appendChild(annotationContainer);
  }

  htmlNode.appendChild(divElement);
};

/**
 * Transform `emphasis` xml node to html.
 * @param {!Object} state
 * @param {HTMLElement} htmlNode
 * @param {Element} xmlNode
 */
var transformEmphasisNode = function(state, htmlNode, xmlNode) {
  var iElement = htmlNode.ownerDocument.createElement('i');
  iElement.setAttribute(CFI_ATTRIBUTE, state.cfiBuilder.toString());

  transformChildNodes(state, iElement, xmlNode);
  htmlNode.appendChild(iElement);
};

/**
 * Transform `empty-line` xml node to html.
 * @param {!Object} state
 * @param {HTMLElement} htmlNode
 * @param {Element} xmlNode
 */
var transformEmptyLineNode = function(state, htmlNode, xmlNode) {
  var brElement = htmlNode.ownerDocument.createElement('br');
  brElement.setAttribute(CFI_ATTRIBUTE, state.cfiBuilder.toString());

  htmlNode.appendChild(brElement);
};

/**
 * Transform `image` xml node to html.
 * @param {!Object} state
 * @param {HTMLElement} htmlNode
 * @param {Element} xmlNode
 */
var transformImageNode = function(state, htmlNode, xmlNode) {
  var imageElement = htmlNode.ownerDocument.createElement('img');
  var src = xmlNode.getAttributeNS(xmlNamespaces.fb2('xlink'), 'href');
  if (src[0] === '#') {
    src = src.substr(1);
    var binary = xmlUtils.getFirstMatchByXpath(xmlNode.ownerDocument,
        xmlNamespaces.fb2, '/fb2:FictionBook/fb2:binary[@id="' + src + '"]');
    if (binary) {
      imageElement.src = 'data:' +
          binary.getAttribute('content-type') +
          ';base64,' +
          binary.textContent;
    }
  } else {
    imageElement.src = src;
  }

  var divElement = htmlNode.ownerDocument.createElement('div');
  divElement.setAttribute(CFI_ATTRIBUTE, state.cfiBuilder.toString());
  divElement.appendChild(imageElement);

  htmlNode.appendChild(divElement);
};

/**
 * Transform `p` xml node to html.
 * @param {!Object} state
 * @param {HTMLElement} htmlNode
 * @param {Element} xmlNode
 */
var transformPNode = function(state, htmlNode, xmlNode) {
  var parentTagName = xmlNode.parentElement.tagName.toLowerCase();
  switch (parentTagName) {
    case 'title':
      if (htmlNode.childElementCount > 0) {
        var brElement = htmlNode.ownerDocument.createElement('br');
        htmlNode.appendChild(brElement);
      }
      var spanElement = htmlNode.ownerDocument.createElement('span');
      spanElement.setAttribute(CFI_ATTRIBUTE, state.cfiBuilder.toString());
      transformChildNodes(state, spanElement, xmlNode);
      htmlNode.appendChild(spanElement);
      break;
    default:
      var pElement = htmlNode.ownerDocument.createElement('p');
      pElement.setAttribute(CFI_ATTRIBUTE, state.cfiBuilder.toString());
      appendAnchor(pElement, xmlNode);
      transformChildNodes(state, pElement, xmlNode);
      htmlNode.appendChild(pElement);
  }
};

/**
 * Transform `section` xml node to html.
 * @param {!Object} state
 * @param {HTMLElement} htmlNode
 * @param {Element} xmlNode
 */
var transformSectionNode = function(state, htmlNode, xmlNode) {
  state.sectionNameBuilder.enterSection();

  var sectionElement = htmlNode.ownerDocument.createElement('div');
  sectionElement.classList.add('reader-parser--book-section');
  sectionElement.setAttribute(SECTION_NAME_ATTRIBUTE,
      state.sectionNameBuilder.getSectionId());
  sectionElement.setAttribute(CFI_ATTRIBUTE, state.cfiBuilder.toString());

  appendSectionAnchor(state, sectionElement, xmlNode);
  appendAnchor(sectionElement, xmlNode);

  transformChildNodes(state, sectionElement, xmlNode);
  htmlNode.appendChild(sectionElement);

  state.sectionNameBuilder.leaveSection();
};

/**
 * Transform `stanza` xml node to html.
 * @param {!Object} state
 * @param {HTMLElement} htmlNode
 * @param {Element} xmlNode
 */
var transformStanzaNode = function(state, htmlNode, xmlNode) {
  var spanElement = htmlNode.ownerDocument.createElement('span');
  spanElement.setAttribute(CFI_ATTRIBUTE, state.cfiBuilder.toString());

  appendAnchor(spanElement, xmlNode);
  transformChildNodes(state, spanElement, xmlNode);
  htmlNode.appendChild(spanElement);

  var brElement = htmlNode.ownerDocument.createElement('br');
  htmlNode.appendChild(brElement);
};

/**
 * Transform `strikethrough` xml node to html.
 * @param {!Object} state
 * @param {HTMLElement} htmlNode
 * @param {Element} xmlNode
 */
var transformStrikeThroughNode = function(state, htmlNode, xmlNode) {
  var sElement = htmlNode.ownerDocument.createElement('s');
  sElement.setAttribute(CFI_ATTRIBUTE, state.cfiBuilder.toString());

  transformChildNodes(state, sElement, xmlNode);
  htmlNode.appendChild(sElement);
}

/**
 * Transform `strong` xml node to html.
 * @param {!Object} state
 * @param {HTMLElement} htmlNode
 * @param {Element} xmlNode
 */
var transformStrongNode = function(state, htmlNode, xmlNode) {
  var bElement = htmlNode.ownerDocument.createElement('b');
  bElement.setAttribute(CFI_ATTRIBUTE, state.cfiBuilder.toString());

  transformChildNodes(state, bElement, xmlNode);
  htmlNode.appendChild(bElement);
};

/**
 * Transform `style` xml node to html.
 * @param {!Object} state
 * @param {HTMLElement} htmlNode
 * @param {Element} xmlNode
 */
var transformStyleNode = function(state, htmlNode, xmlNode) {
  var spanElement = htmlNode.ownerDocument.createElement('span');
  spanElement.classList.add('reader-parser--' + xmlNode.getAttribute('name'));
  spanElement.setAttribute(CFI_ATTRIBUTE, state.cfiBuilder.toString());

  transformChildNodes(state, spanElement, xmlNode);
  htmlNode.appendChild(spanElement);
};

var transformSubNode = function(state, htmlNode, xmlNode) {
  var element = htmlNode.ownerDocument.createElement('sub');
  element.setAttribute(CFI_ATTRIBUTE, state.cfiBuilder.toString());

  transformChildNodes(state, element, xmlNode);
  htmlNode.appendChild(element);
}

/**
 * Transform `subtitle` xml node to html.
 * @param {!Object} state
 * @param {HTMLElement} htmlNode
 * @param {Element} xmlNode
 */
var transformSubtitleNode = function(state, htmlNode, xmlNode) {
  var h5Element = htmlNode.ownerDocument.createElement('h5');
  h5Element.setAttribute(CFI_ATTRIBUTE, state.cfiBuilder.toString());

  appendAnchor(h5Element, xmlNode);

  transformChildNodes(state, h5Element, xmlNode);
  htmlNode.appendChild(h5Element);
};

var transformSupNode = function(state, htmlNode, xmlNode) {
  var element = htmlNode.ownerDocument.createElement('sup');
  element.setAttribute(CFI_ATTRIBUTE, state.cfiBuilder.toString());

  transformChildNodes(state, element, xmlNode);
  htmlNode.appendChild(element);
}

/**
 * Transform `text-author` xml node to html.
 * @param {!Object} state
 * @param {HTMLElement} htmlNode
 * @param {Element} xmlNode
 */
var transformTextAuthorNode = function(state, htmlNode, xmlNode) {
  var bElement = htmlNode.ownerDocument.createElement('strong');

  transformChildNodes(state, bElement, xmlNode);

  var quoteElement = htmlNode.ownerDocument.createElement('blockquote');
  quoteElement.setAttribute(CFI_ATTRIBUTE, state.cfiBuilder.toString());
  quoteElement.appendChild(bElement);

  htmlNode.appendChild(quoteElement);
};

/**
 * Transform any unknown xml node to html.
 * @param {!Object} state
 * @param {HTMLElement} htmlNode
 * @param {Element} xmlNode
 */
var transformUnknownNode = function(state, htmlNode, xmlNode) {
  var divElement = htmlNode.ownerDocument.createElement('div');
  divElement.setAttribute(CFI_ATTRIBUTE, state.cfiBuilder.toString());

  transformChildNodes(state, divElement, xmlNode);
  htmlNode.appendChild(divElement);
};

/**
 * Transform `title` xml node to html.
 * @param {!Object} state
 * @param {HTMLElement} htmlNode
 * @param {Element} xmlNode
 */
var transformTitleNode = function(state, htmlNode, xmlNode) {
  var headerElement;
  // Determining header level. Max header level is 6 for <h6>.
  var headerLevel = Math.min(state.sectionNameBuilder.getSectionLevel() + 1, 6);
  headerElement = htmlNode.ownerDocument.createElement('h' + headerLevel);
  headerElement.classList.add('reader-parser--book-title');
  headerElement.setAttribute(CFI_ATTRIBUTE, state.cfiBuilder.toString());

  transformChildNodes(state, headerElement, xmlNode);
  htmlNode.appendChild(headerElement);
};

/**
 * Transform `v` xml node to html.
 * @param {!Object} state
 * @param {HTMLElement} htmlNode
 * @param {Element} xmlNode
 */
var transformVNode = function(state, htmlNode, xmlNode) {
  var spanElement = htmlNode.ownerDocument.createElement('span');
  spanElement.setAttribute(CFI_ATTRIBUTE, state.cfiBuilder.toString());

  appendAnchor(spanElement, xmlNode);
  transformChildNodes(state, spanElement, xmlNode);
  htmlNode.appendChild(spanElement);

  var brElement = htmlNode.ownerDocument.createElement('br');
  htmlNode.appendChild(brElement);
};

/**
 * FB2 node transforms.
 * @type {Object}
 */
var nodeTransforms = {
  'a': transformANode,
  'body': transformBodyNode,
  'cite': transformCiteOrEpigraphOrPoemNode,
  'code': transformCodeNode,
  'date': transformDateNode,
  'description': transformDescriptionNode,
  'emphasis': transformEmphasisNode,
  'empty-line': transformEmptyLineNode,
  'epigraph': transformCiteOrEpigraphOrPoemNode,
  'image': transformImageNode,
  'p': transformPNode,
  'poem': transformCiteOrEpigraphOrPoemNode,
  'section': transformSectionNode,
  'stanza': transformStanzaNode,
  'strikethrough': transformStrikeThroughNode,
  'strong': transformStrongNode,
  'style': transformStyleNode,
  'sub': transformSubNode,
  'subtitle': transformSubtitleNode,
  'sup': transformSupNode,
  'text-author': transformTextAuthorNode,
  'title': transformTitleNode,
  'v': transformVNode
};

/**
 * Regexp to check if node is empty.
 * @type {RegExp}
 */
var emptyTextRegex = /^\s+$/;

/**
 * Transform node xml list to html.
 * @param {!Object} state
 * @param {HTMLElement} htmlNode
 * @param {Node} xmlNode
 */
var transformChildNodes = function(state, htmlNode, xmlNode) {
  var xmlChildNodes = xmlNode.childNodes;
  var nodesCount = xmlChildNodes.length;
  if (nodesCount === 0) {
    return;
  }
  if (nodesCount === 1 && xmlChildNodes[0].nodeType === Node.TEXT_NODE) {
    htmlNode.appendChild(
        htmlNode.ownerDocument.createTextNode(xmlChildNodes[0].textContent));
    return;
  }

  state.cfiBuilder.enterChild();
  var i;
  var previousNodeType = null;
  for (i = 0; i < nodesCount; i++) {
    var bookXmlChildNode = xmlChildNodes[i];
    if (bookXmlChildNode.nodeType !== Node.ELEMENT_NODE &&
        bookXmlChildNode.nodeType !== Node.TEXT_NODE) {
      continue;
    }

    if (bookXmlChildNode.nodeType === Node.TEXT_NODE) {
      var textContent = bookXmlChildNode.textContent;
      if (textContent !== '\n' && !emptyTextRegex.test(textContent)) {
        var spanNode = htmlNode.ownerDocument.createElement('span');
        spanNode.setAttribute(CFI_ATTRIBUTE, state.cfiBuilder.toString());
        spanNode.textContent = textContent;
        htmlNode.appendChild(spanNode);
      } else {
        htmlNode.appendChild(
            htmlNode.ownerDocument.createTextNode(textContent));
      }
    } else {
      if (previousNodeType !== Node.TEXT_NODE) {
        state.cfiBuilder.nextSibling();
      }

      var tagName = bookXmlChildNode.tagName.toLowerCase();
      var transform = nodeTransforms[tagName];
      if (!transform) {
        console.warn('Unknown fb2 node ' + tagName);
        transform = transformUnknownNode;
      }

      transform(state, htmlNode, bookXmlChildNode);
    }

    previousNodeType = bookXmlChildNode.nodeType;
    state.cfiBuilder.nextSibling();
  }
  state.cfiBuilder.leaveChild();
};

/**
 * Transform book from fb2 xml to html document.
 * @param {Document} bookXml
 * @return {Document}
 */
var transformBook = function(bookXml) {
  var bookHtml = document.implementation.createHTMLDocument();
  var state = {
    cfiBuilder: new CfiBuilder(),
    sectionNameBuilder: new SectionNameBuilder()
  };

  state.cfiBuilder.enterChild();
  state.cfiBuilder.nextSibling();

  var bookElement = xmlUtils.getFirstMatchByXpath(
      bookXml, xmlNamespaces.fb2, '/fb2:FictionBook');
  var bookChildElement;
  var i;
  for (i = 0; i < bookElement.childElementCount; i++) {
    bookChildElement = bookElement.children[i];
    if (bookChildElement.tagName.toLowerCase() === 'description') {
      transformDescriptionNode(state, bookHtml.body, bookChildElement);
    }
    if (bookChildElement.tagName.toLowerCase() === 'body') {
      transformBodyNode(state, bookHtml.body, bookChildElement);
    }

    state.cfiBuilder.nextSibling();
    state.cfiBuilder.nextSibling();
  }
  state.cfiBuilder.leaveChild();

  return bookHtml;
};

module.exports = {
  transformBook: transformBook
};

},{"../../common/cfi_builder":4,"../../common/xml_utils":13,"./fb2_section_name_builder":34,"./fb2_xml_namespaces":36}],31:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

// Dependencies.
var core = require('../../common/core');
var fb2NodeToText = require('./fb2_node_to_text');
var Metadata = require('../base/metadata');
var textUtils = require('../../common/text_utils');
var xmlNamespaces = require('./fb2_xml_namespaces');
var xmlUtils = require('../../common/xml_utils');

/**
 * Get description element text value.
 * @param {!Document} packageXml
 * @param {Array.<string>|string} xpath
 * @return {string}
 */
function getDescriptionTextByXpath(packageXml, xpath) {
  var description = xmlUtils.getFirstMatchByXpath(
      packageXml, xmlNamespaces.fb2, '/fb2:FictionBook/fb2:description');
  if (!description) {
    return '';
  }

  var element = xmlUtils.getFirstMatchByXpath(
      description, xmlNamespaces.fb2, xpath);

  return element ? fb2NodeToText.nodeToText(element) : '';
}

/**
 * Epub book metadata.
 * @param {!Document} packageXml
 * @extends {Metadata}
 * @constructor
 */
function EpubMetadata (packageXml) {
  EpubMetadata.superclass.constructor.apply(this);

  this.publisher_ =
      getDescriptionTextByXpath(packageXml, 'fb2:publish-info/fb2:publisher');
  var date = getDescriptionTextByXpath(
      packageXml, 'fb2:document-info/fb2:date');
  var dateParse = /.*(\d{4}).*/.exec(date);
  this.year_ = dateParse ? dateParse[1] : '';
  this.bookTitle_ =
      getDescriptionTextByXpath(packageXml, 'fb2:title-info/fb2:book-title');
  this.creator_ =
      getDescriptionTextByXpath(
          packageXml, 'fb2:title-info/fb2:author/fb2:first-name') + ' ' +
      getDescriptionTextByXpath(
          packageXml, 'fb2:title-info/fb2:author/fb2:middle-name') + ' ' +
      getDescriptionTextByXpath(
          packageXml, 'fb2:title-info/fb2:author/fb2:last-name');
  this.creator_ = textUtils.normalizeText(this.creator_);
  this.description_ =
      getDescriptionTextByXpath(packageXml, 'fb2:title-info/fb2:annotation');
}
core.extend(EpubMetadata, Metadata);

// Exports.
module.exports = EpubMetadata;

},{"../../common/core":6,"../../common/text_utils":11,"../../common/xml_utils":13,"../base/metadata":17,"./fb2_node_to_text":32,"./fb2_xml_namespaces":36}],32:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

// Dependencies.
var textUtils = require('../../common/text_utils');

/**
 * FB2 block elements.
 * @type {Array.<string>}
 */
var fb2BlockElements = ['cite', 'empty-line', 'epigraph', 'p', 'poem',
  'stanza', 'subtitle', 'text-author','title','v'];

/**
 * Normalize text spaces and newlines.
 * @param {Element} rootNode
 * @return {string}
 */
var nodeToText = function(rootNode) {
  var result = [];

  var processNode = function(node) {
    var nodeType = node.nodeType;

    if (nodeType === Node.DOCUMENT_NODE) {
      processNode(node.documentElement);
      return;
    }

    if (nodeType === Node.TEXT_NODE) {
      result.push(node.nodeValue);
      return;
    }

    if (nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    var tagName = node.tagName.toLowerCase();
    var isBlockElement = fb2BlockElements.indexOf(tagName) !== -1;
    if (isBlockElement) {
      result.push('\n');
    }
    var i;
    for (i = 0; i < node.childNodes.length; i++) {
      processNode(node.childNodes[i]);
    }
    if (isBlockElement) {
      result.push('\n');
    }
  };

  processNode(rootNode);
  return textUtils.normalizeText(result.join(' '));
};

module.exports = {
  nodeToText: nodeToText
};

},{"../../common/text_utils":11}],33:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

// Dependencies.
var BookPackage = require('../base/book_package');
var core = require('../../common/core');
var Fb2Document = require('./fb2_document');
var Fb2Metadata = require('./fb2_metadata');
var Fb2TocTree = require('./fb2_toc_tree');
var httpUtils = require('../../common/http_utils');
var Unarchiver = require('../../common/unarchiver');

/**
 * FB2 package.
 * @extends {BookPackage}
 * @param {!Document} bookXml
 * @param {number} streamSize
 * @constructor
 */
var Fb2Package = function(bookXml, streamSize) {
  Fb2Package.superclass.constructor.call(this);

  this.bookDocument_ = new Fb2Document(bookXml);
  this.metadata_ = new Fb2Metadata(bookXml);
  this.tocTree_ = null;
  this.streamSize_ = streamSize;
};
core.extend(Fb2Package, BookPackage);

/**
 * @override
 */
Fb2Package.prototype.getMetadata = function() {
  return Promise.resolve(this.metadata_);
};

/**
 * @override
 */
Fb2Package.prototype.getTocTree = function() {
  var that = this;
  if (that.tocTree_) {
    return Promise.resolve(that.tocTree_);
  }

  return that.getDocument().then(function(document) {
    return document.getDocumentHtml();
  }).then(function(htmlDocument) {
    that.tocTree_ = new Fb2TocTree(htmlDocument);
    return that.tocTree_;
  });
};

/**
 * @override
 */
Fb2Package.prototype.getStreamSize = function() {
  return this.streamSize_;
};

/**
 * Return book document.
 * @return {Promise.<Fb2Document>}
 */
Fb2Package.prototype.getDocument = function() {
  return Promise.resolve(this.bookDocument_);
};

/**
 * @override
 */
Fb2Package.prototype.dispose = function() {
  Fb2Package.superclass.dispose.call(this);

  this.bookDocument_ = null;
  this.metadata_ = null;
  this.tocTree_ = null;
  this.streamSize_ = null;
};

/**
 * Open book from provided url.
 * @param {string} streamUrl
 * @return {Promise.<EpubPackage>}
 * @static
 */
Fb2Package.openBookFromPlainUrl = function(streamUrl) {
  return httpUtils.requestXml(streamUrl)
      .then(function(response) {
        var fb2Xml = response.result;
        var streamSize = response.size;
        return new Fb2Package(fb2Xml, streamSize);
      });
};

/**
 * Open book from provided url.
 * @param {string} streamUrl
 * @return {Promise.<EpubPackage>}
 * @static
 */
Fb2Package.openBookFromZipUrl = function(streamUrl) {
  return Unarchiver.openZipFromUrl(streamUrl).then(function(unarchiver) {
    var streamSize = unarchiver.getStreamSize();

    return unarchiver.getEntries().then(function(entries) {
      var i;
      for (i = 0; i < entries.length; i++) {
        if (/\.fb2$/.test(entries[i])) {
          return unarchiver.getXml(entries[i]);
        }
      }

      throw new Error('No fb2 entry found in archive');
    }).then(function(fb2Xml) {
      unarchiver.dispose();
      return new Fb2Package(fb2Xml, streamSize);
    }, function(error) {
      unarchiver.dispose();
      throw error;
    });
  });
};

// Exports.
module.exports = Fb2Package;

},{"../../common/core":6,"../../common/http_utils":8,"../../common/unarchiver":12,"../base/book_package":16,"./fb2_document":29,"./fb2_metadata":31,"./fb2_toc_tree":35}],34:[function(require,module,exports){
// Copyright (c) 2016 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

/**
 * State for book transforming.
 * @constructor
 */
function SectionNameBuilder() {
  this.sectionLevel_ = 0;
  this.sectionPath_ = [0];
}

/**
 * Handle section enter.
 */
SectionNameBuilder.prototype.enterSection = function() {
  this.sectionLevel_++;
  this.sectionPath_.push(0);
};

/**
 * Handle section leave.
 */
SectionNameBuilder.prototype.leaveSection = function() {
  this.sectionLevel_--;
  this.sectionPath_.pop();
  this.sectionPath_[this.sectionLevel_]++;
};

/**
 * Get current section depth.
 * @return {number}
 */
SectionNameBuilder.prototype.getSectionLevel = function() {
  return this.sectionLevel_;
};

/**
 * Get current section id.
 * @return {string}
 */
SectionNameBuilder.prototype.getSectionId = function() {
  return 'TOC-SECTION-' + this.sectionPath_
          .slice(0, this.sectionPath_.length - 1)
          .join('-');
};

// Exports.
module.exports = SectionNameBuilder;

},{}],35:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

// Dependencies.
var core = require('../../common/core');
var fb2NodeToText = require('./fb2_node_to_text');
var textUtils = require('../../common/text_utils');
var TocTreeItem = require('../base/toc_tree_item');
var TocTree = require('../base/toc_tree');
var xmlNamespaces = require('./fb2_xml_namespaces');
var xmlUtils = require('../../common/xml_utils');

/**
 * Create TocTreeItem from provided navPoint element.
 * @param {!Element} sectionElement
 * @return {TocTreeItem}
 */
var createItemFromSection = function(sectionElement) {
  var titleElement = sectionElement
      .querySelector(':scope > .reader-parser--book-title');
  var childrenElements = sectionElement
      .querySelectorAll(':scope > .reader-parser--book-section');

  var title = null;
  if (titleElement) {
    title = fb2NodeToText.nodeToText(titleElement);
    title = textUtils.normalizeText(textUtils.stripNewlines(title));
  }

  var href = '#' + sectionElement
          .getAttribute('reader-parser--fb2-section-name');

  var i;
  var children = [];
  for (i = 0; i < childrenElements.length; i++) {
    children.push(createItemFromSection(childrenElements[i]));
  }

  return new TocTreeItem(title, href, children);
};

/**
 * Book toc tree.
 * @param {!Document} htmlDocument
 * @extends {TocTree}
 * @constructor
 */
function Fb2TocTree(htmlDocument) {
  Fb2TocTree.superclass.constructor.apply(this);
  var that = this;

  var rootSectionElements = htmlDocument.body
      .querySelectorAll(':scope > .reader-parser--book-body');

  var i;
  for (i = 0; i < rootSectionElements.length; i++) {
    that.children_.push(createItemFromSection(rootSectionElements[i]));
  }
}
core.extend(Fb2TocTree, TocTree);


// Exports.
module.exports = Fb2TocTree;

},{"../../common/core":6,"../../common/text_utils":11,"../../common/xml_utils":13,"../base/toc_tree":18,"../base/toc_tree_item":19,"./fb2_node_to_text":32,"./fb2_xml_namespaces":36}],36:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

/**
 * Namespace resolver for OPF xml document.
 * @param {string} prefix
 * @return {string}
 */
var fb2Namespace = function(prefix) {
  var namespaces = {
    'fb2': 'http://www.gribuser.ru/xml/fictionbook/2.0',
    'xlink': 'http://www.w3.org/1999/xlink',
    'xsi': 'http://www.w3.org/2001/XMLSchema-instance'
  };
  return namespaces[prefix] || null;
};

// Exports.
module.exports = {
  fb2: fb2Namespace
};

},{}],37:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

// Dependencies.
var core = require('../../common/core');
var EventEmitter = require('../../common/event_emitter');
var FlippingPageRenderer = require('../../render/page/flipping_page_renderer');
var ReaderCursor = require('../../common/reader_cursor');
var ScrollRenderer = require('../../render/scroll/scroll_renderer');

/**
 * @enum {string}
 */
var RenderMode = Object.freeze({
  PAGE: 'page',
  SCROLL: 'scroll',
});

/**
 * Reader core object.
 * @param {!BookPackage} bookPackage
 * @param {!Renderer} renderer
 * @constructor
 */
function ReaderCore(bookPackage, renderer) {
  ReaderCore.superclass.constructor.apply(this);

  this.package_ = bookPackage;
  this.renderer_ = renderer;

  this.currentProgress_ = {unknown: true};

  if (renderer instanceof ScrollRenderer) {
    this.renderMode_ = ReaderCore.RenderMode.SCROLL;
  } else if (renderer instanceof FlippingPageRenderer) {
    this.renderMode_ = ReaderCore.RenderMode.PAGE;
  } else {
    throw new Error('Unknown renderer object');
  }

  this.presentationOptions_ = ReaderCore.getDefaultPresentationOptions();
  this.setupRenderer_();
}
core.extend(ReaderCore, EventEmitter);

/**
 * Return book package.
 * @return {!Promise.<BookPackage>}
 */
ReaderCore.prototype.getPackage = function() {
  return Promise.resolve(this.package_);
};

/**
 * Navigate to book start.
 * @return {Promise}
 * @abstract
 */
ReaderCore.prototype.navigateBookStart = function() {
  throw new Error('Method not implemented');
};

/**
 * Navigate to last page.
 * @return {Promise}
 * @abstract
 */
ReaderCore.prototype.navigateBookEnd = function() {
  throw new Error('Method not implemented');
};

/**
 * Navigate to provided cfi.
 * @param {string} cfi
 * @return {Promise}
 * @abstract
 */
ReaderCore.prototype.navigateCfi = function(cfi) {
  throw new Error('Method not implemented');
};

/**
 * Navigate to next page.
 * @return {Promise}
 * @abstract
 */
ReaderCore.prototype.navigateNextPage = function() {
  throw new Error('Method not implemented');
};

/**
 * Navigate to next page.
 * @return {Promise}
 * @abstract
 */
ReaderCore.prototype.navigatePrevPage = function() {
  throw new Error('Method not implemented');
};

/**
 * Navigate by specified href.
 * @param {string} href
 * @return {Promise}
 * @abstract
 */
ReaderCore.prototype.navigateHref = function(href) {
  throw new Error('Method not implemented');
};

/**
 * Check can reader navigate next and prev.
 * @return {Promise.<object>}
 */
ReaderCore.prototype.canNavigatePrevOrNext = function() {
  throw new Error('Method not implemented');
};

/**
 * Return current cfi.
 * @return {Promise.<?string>}
 */
ReaderCore.prototype.getCurrentCfi = function() {
  return this.calculateCurrentCfi_();
};

/**
 * Check if provided cfi is currently on screen.
 * @param {string} cfi
 * @return {Promise.<boolean>}
 * @abstract
 */
ReaderCore.prototype.isCfiOnCurrentScreen = function(cfi) {
  throw new Error('Method not implemented');
};

/**
 * Return current progress.
 * @return {Promise.<Object>}
 */
ReaderCore.prototype.getCurrentProgress = function() {
  return Promise.resolve(this.currentProgress_);
};

/**
 * Return current text fragment.
 * @return {Promise.<string>}
 */
ReaderCore.prototype.getCurrentTextFragment = function() {
  return Promise.resolve(this.renderer_.getCurrentTextFragment());
};

/**
 * Create element cursor.
 * @return {Promise.<ReaderCursor>}
 */
ReaderCore.prototype.createCursor = function() {
  const that = this;
  var rendererCursor;
  return  this.renderer_.createCursor().then(function(cursor) {
    rendererCursor = cursor;
    var result = new ReaderCursor(function() {
      return rendererCursor.next().then(function(next) {
        if (next) {
          return next;
        }

        return that.canNavigatePrevOrNext().then(function(canNavigate) {
          if (!canNavigate.next) {
            result.close();
            return null;
          }

          return that.navigateNextPage();
        }).then(function() {
          return that.renderer_.createCursor();
        }).then(function(cursor) {
          rendererCursor = cursor;
          return cursor.next();
        });
      });
    });
    return result;
  });
};

/**
 * Set current progress and notify listeners.
 * @return {Promise}
 * @private
 */
ReaderCore.prototype.setCurrentProgress_ = function(progress) {
  this.currentProgress_ = progress;
  this.dispatchEvent_('progressChanged', progress);
  return Promise.resolve(progress);
};

/**
 * Calculate current cfi.
 * @return {Promise.<?string>}
 * @abstract
 */
ReaderCore.prototype.calculateCurrentCfi_ = function() {
  throw new Error('Method not implemented');
};

/**
 * Return current presentation options.
 * @return {Object}
 */
ReaderCore.prototype.getPresentationOptions = function() {
  return {
    fontFamily: this.presentationOptions_.fontFamily,
    fontSize: this.presentationOptions_.fontSize,
  };
};

/**
 * Update current presentation options.
 * @return {Promise}
 * @virtual
 */
ReaderCore.prototype.updatePresentationOptions = function(value) {
  var that = this;

  if (value.hasOwnProperty('fontSize') &&
      value.fontSize >= 12 && value.fontSize <= 50) {
    that.presentationOptions_.fontSize = value.fontSize;
  }

  return that.resetCurrentProgressData_().then(function() {
    that.renderer_.setPresentationOptions(that.presentationOptions_);
  });
};

/**
 * Calculate current progress.
 * @return {Promise}
 * @abstract
 */
ReaderCore.prototype.calculateCurrentProgress_ = function() {
  throw new Error('Method not implemented');
};

/**
 * Reset current progress data.
 * @return {Promise}
 * @virtual
 */
ReaderCore.prototype.resetCurrentProgressData_ = function() {
  return this.setCurrentProgress_({unknown: true});
};

/**
 * Handle renderer navigate.
 * @return {Promise}
 * @virtual
 */
ReaderCore.prototype.handleRendererNavigate_ = function(data) {
};

/**
 * Handle renderer page changed.
 * @return {Promise}
 * @virtual
 */
ReaderCore.prototype.handleRendererPageChanged_ = function() {
  var that = this;

  that.dispatchEvent_('pageChanged');
  return that.calculateCurrentProgress_().then(function(progress) {
    return that.setCurrentProgress_(progress);
  });
};

/**
 * Handle renderer resize.
 * @return {Promise}
 */
ReaderCore.prototype.handleRendererResize_ = function() {
  return this.resetCurrentProgressData_();
};

/**
 * Destroy reader core object and free all internal resources.
 * @virtual
 */
ReaderCore.prototype.dispose = function() {
  ReaderCore.superclass.dispose.apply(this, arguments);

  this.package_.dispose();
  this.renderer_.dispose();

  this.package_ = null;
  this.renderer_ = null;
};

/**
 * Renderers.
 * @type {Object}
 * @private
 */
ReaderCore.prototype.renderers_ = Object.freeze({
  [RenderMode.SCROLL]: ScrollRenderer,
  [RenderMode.PAGE]: FlippingPageRenderer,
});

/**
 * Set renderer.
 * @param {Renderer} type
 * @return {Promise}
 * @private
 */
ReaderCore.prototype.switchRenderer_ = function(type) {
  var container = this.renderer_.getContainer();
  this.renderer_.dispose();

  var that = this;

  return type.create(container)
      .then(function(renderer) {
        that.renderer_ = renderer;
      })
      .then(function() {
        that.setupRenderer_();
      })
      .then(function() {
        return that.reload();
      });
};

/**
 * @param {string} mode
 * @return {Promise}
 */
ReaderCore.prototype.setRenderMode = function(mode) {
  if (this.renderMode_ === mode) {
    return Promise.resolve();
  }

  var renderer = this.renderers_[mode];
  if (!renderer) {
    return Promise.reject('Unknown reader core render mode ' + mode);
  }

  this.renderMode_ = mode;
  return this.switchRenderer_(renderer);
};

/**
 * @return {string}
 */
ReaderCore.prototype.getRenderMode = function() {
  return this.renderMode_;
};

/**
 * Reload book.
 * @abstract
 */
ReaderCore.prototype.reload = function() {
};

/**
 * @param {number} scrollLength
 * @return {Promise}
 */
ReaderCore.prototype.scrollBook = function(scrollLength) {
  if (this.renderMode_ === ReaderCore.RenderMode.PAGE) {
    throw new Error('Cannot scroll in page render mode.');
  }
  return this.renderer_.scrollBook(scrollLength);
};

/**
 * Listen for renderer events.
 */
ReaderCore.prototype.setupRenderer_ = function() {
  var that = this;
  that.renderer_.setPresentationOptions(that.presentationOptions_);

  that.renderer_.addEventListener('navigate', function(data) {
    that.handleRendererNavigate_(data);
  });
  that.renderer_.addEventListener('pageChanged', function() {
    that.handleRendererPageChanged_();
  });
  that.renderer_.addEventListener('resize', function() {
    that.handleRendererResize_();
  });
  that.renderer_.addEventListener('bookKeydown', function(e) {
    that.dispatchEvent_('bookKeydown', e);
  });
}

/**
 * Get default renderer.
 *
 * @param {!Element} container
 * @return {Promise}
 * @static
 */
ReaderCore.createRenderer = function(container) {
  return FlippingPageRenderer.create(container);
};

/**
 * Create default presentation options.
 * @return {Object}
 * @static
 */
ReaderCore.getDefaultPresentationOptions = function() {
  return {
    fontFamily: 'Georgia, serif',
    fontSize: 20
  };
};

/**
 * Render mode values.
 * @enum {string}
 */
ReaderCore.RenderMode = RenderMode;

// Exports.
module.exports = ReaderCore;

},{"../../common/core":6,"../../common/event_emitter":7,"../../common/reader_cursor":10,"../../render/page/flipping_page_renderer":46,"../../render/scroll/scroll_renderer":51}],38:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

// Dependencies.
var asyncUtils = require('../../common/async_utils');
var CancellationToken = require('../../common/cancellation_token');
var EpubChaptersSize = require('./epub_chapters_size');
var MeasurePageRenderer = require('../../render/page/measure_page_renderer');


/**
 * Measure all chapters and return pages count.
 * @return {Promise.<Array>}
 * @private
 */
var measureChapters = function(chapters, measureRenderer, cancellation) {
  return asyncUtils.asyncFor(0, chapters.getChaptersCount(), function(i) {
    cancellation.throwIfCancelled();

    var chapter = chapters.getByIndex(i);
    return measureRenderer
        .renderDocument(chapter)
        .then(function() {
          return measureRenderer.getPagesCount();
        });
  });
};

/**
 * Chapters measurer.
 * @param {!EpubPackage} epubPackage
 * @param {!HTMLElement} container
 * @constructor
 */
function EpubChaptersMeasurer(epubPackage, container) {
  this.epubPackage_ = epubPackage;
  this.container_ = container;

  this.cancellation_ = null;
  this.cachedResult_ = null;
  this.currentProcess_ = null;
}

/**
 * Reset current size, force measurer to remeasure all chapters.
 */
EpubChaptersMeasurer.prototype.reset = function() {
  if (this.cancellation_) {
    this.cancellation_.cancel();
  }

  this.cancellation_ = null;
  this.cachedResult_ = null;
  this.currentProcess_ = null;
};

/**
 * Return chapters size info object.
 * @param {Object} presentationOptions
 * @return {Promise.<EpubChaptersSize>}
 */
EpubChaptersMeasurer.prototype.getChaptersSize = function(presentationOptions) {
  var that = this;

  if (that.cachedResult_) {
    return Promise.resolve(that.cachedResult_);
  }
  if (that.currentProcess_) {
    return that.currentProcess_;
  }

  that.cancellation_ = new CancellationToken();
  that.currentProcess_ = that
      .measureChaptersSize_(presentationOptions, that.cancellation_)
      .then(function(chaptersSize) {
        that.currentProcess_ = null;

        that.cachedResult_ = chaptersSize;
        return that.cachedResult_;
      })
      .catch(function(error) {
        that.currentProcess_ = null;
        throw error;
      });

  return that.currentProcess_;
};

/**
 * Measure chapters size.
 * @param {Object} presentationOptions
 * @param {CancellationToken} cancellation
 * @return {Promise.<EpubChaptersSize>}
 * @private
 */
EpubChaptersMeasurer.prototype.measureChaptersSize_ = function(
    presentationOptions, cancellation) {
  var that = this;
  return Promise.all([
      that.epubPackage_.getChapters(),
      MeasurePageRenderer.create(that.container_)]
  ).then(function(data) {
    var chapters = data[0];
    var renderer = data[1];
    renderer.setPresentationOptions(presentationOptions);
    return measureChapters(chapters, renderer, cancellation)
        .then(function(measureResult) {
          renderer.dispose();
          return new EpubChaptersSize(measureResult);
        })
        .catch(function(error) {
          renderer.dispose();
          throw error;
        });
  });
};

/**
 * Destroy chapters measurer object and free all internal resources.
 */
EpubChaptersMeasurer.prototype.dispose = function() {
  this.reset();

  this.container_ = null;
};


/**
 * Create renderer with provided container element.
 * @param {!EpubPackage} epubPackage
 * @param {!HTMLElement} container
 * @return {Promise.<MeasurePageRenderer>}
 * @static
 */
EpubChaptersMeasurer.create = function(epubPackage, container) {
  return Promise.resolve(new EpubChaptersMeasurer(epubPackage, container));
};

// Exports.
module.exports = EpubChaptersMeasurer;

},{"../../common/async_utils":1,"../../common/cancellation_token":2,"../../render/page/measure_page_renderer":47,"./epub_chapters_size":39}],39:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

/**
 * Chapters size.
 * @param {!Array.<Number>} measureResults
 * @constructor
 */
function EpubChaptersSize(measureResults) {
  this.measureResults_ = measureResults;
  this.sizesBeforeChapter_ = [];
}

/**
 * Return chapter size by it's index.
 * @param index
 * @return {number}
 */
EpubChaptersSize.prototype.getChapterSize = function(index) {
  return this.measureResults_[index];
};

/**
 * Return total chapters size.
 * @return {number}
 */
EpubChaptersSize.prototype.getTotalSize = function() {
  if (this.totalSize_) {
    return this.totalSize_;
  }

  this.totalSize_ = this.measureResults_.reduce(function(total, size) {
    return total + size;
  }, 0);
  return this.totalSize_;
};

/**
 * Return size before specified chapter.
 * @param {number} index
 * @return {number}
 */
EpubChaptersSize.prototype.getSizeBeforeChapter = function(index) {
  if (this.sizesBeforeChapter_[index]) {
    return this.sizesBeforeChapter_[index];
  }

  this.sizesBeforeChapter_[index] =
      this.measureResults_.reduce(function(total, size, currentIndex) {
        return total + (currentIndex < index ? size : 0);
      }, 0);
  return this.sizesBeforeChapter_[index];
};

// Exports.
module.exports = EpubChaptersSize;

},{}],40:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

// Dependencies.
var core = require('../../common/core');
var EpubChaptersMeasurer = require('./epub_chapters_measurer');
var EpubPackage = require('../../parser/epub/epub_package');
var FlippingPageRenderer = require('../../render/page/flipping_page_renderer');
var paths = require('../../common/paths');
var ReaderCore = require('../base/reader_core');
var EpubRendererCss = require('./epub_renderer.css');

/**
 * Reader epub core object.
 * @param {!EpubPackage} epubPackage
 * @param {!FlippingPageRenderer} renderer
 * @param {!EpubChaptersMeasurer} chaptersMeasurer
 * @extends {ReaderCore}
 * @constructor
 */
function EpubReaderCore(epubPackage, renderer, chaptersMeasurer) {
  EpubReaderCore.superclass.constructor.apply(this, [epubPackage, renderer]);

  this.currentChapter_ = null;
  this.chaptersMeasurer_ = chaptersMeasurer;
}
core.extend(EpubReaderCore, ReaderCore);

/**
 * Listen for renderer events.
 * @override
 */
EpubReaderCore.prototype.setupRenderer_ = function() {
  EpubReaderCore.superclass.setupRenderer_.apply(this);
  this.renderer_.injectStyle(EpubRendererCss);
}

/**
 * @return {Promise}
 * @override
 */
EpubReaderCore.prototype.navigateBookStart = function() {
  var that = this;

  return this.package_.getChapters().then(function(chapters) {
    var chapter = chapters.getFirstLinear();
    if (!chapter) {
      return Promise.reject('No linear chapters found');
    }

    return that.renderChapter_(chapter);
  }).then(function() {
    return that.renderer_.navigatePage(0);
  });
};

/**
 * @return {Promise}
 * @override
 */
EpubReaderCore.prototype.navigateNextPage = function() {
  var that = this;
  if (!that.currentChapter_) {
    return Promise.reject('Please use some absolute navigation first. ' +
        'For example navigateBookStart or navigateHref.');
  }

  var nextPage = that.renderer_.getCurrentPage() + 1;
  var totalPages = that.renderer_.getPagesCount();
  if (nextPage < totalPages) {
    return that.renderer_.navigatePage(nextPage);
  }

  // Need open next chapter.
  return that.package_.getChapters().then(function(chapters) {
    var chapter = chapters.getNextLinearByChapter(that.currentChapter_);
    if (!chapter) {
      return Promise.reject('No next chapter exists');
    }

    return that.renderChapter_(chapter);
  }).then(function() {
    return that.renderer_.navigatePage(0);
  });
};

/**
 * @return {Promise}
 * @override
 */
EpubReaderCore.prototype.navigatePrevPage = function() {
  var that = this;
  if (!that.currentChapter_) {
    return Promise.reject('Please use some absolute navigation first. ' +
        'For example navigateBookStart or navigateHref.');
  }

  var nextPage = that.renderer_.getCurrentPage() - 1;
  if (nextPage >= 0) {
    return that.renderer_.navigatePage(nextPage);
  }

  // Need open prev chapter.
  return that.package_.getChapters().then(function(chapters) {
    var chapter = chapters.getPrevLinearByChapter(that.currentChapter_);
    if (!chapter) {
      return Promise.reject('No prev chapter exists');
    }

    return that.renderChapter_(chapter);
  }).then(function() {
    var totalPages = that.renderer_.getPagesCount();
    return that.renderer_.navigatePage(totalPages);
  });
};

/**
 * @param {string} cfi
 * @return {Promise}
 * @override
 */
EpubReaderCore.prototype.navigateCfi = function(cfi) {
  var that = this;
  var indexOfIndirectStep = cfi.indexOf('!');
  var chapterCfi;
  var documentCfi;
  if (indexOfIndirectStep < 0) {
    chapterCfi = cfi;
    documentCfi = '';
  } else {
    chapterCfi = cfi.substr(0, indexOfIndirectStep);
    documentCfi = cfi.substr(indexOfIndirectStep + 1);
  }

  if (!chapterCfi) {
    return Promise.reject('Can not find chapter cfi');
  }

  return that.package_.getChapters().then(function(chapters) {
    var chapter = chapters.getByCfi(chapterCfi);
    if (!chapter) {
      return Promise.reject('Chapter ' + chapterCfi + ' not found');
    }

    return that.renderChapter_(chapter);
  }).then(function() {
    return documentCfi ?
        that.renderer_.navigateCfi(documentCfi) :
        that.renderer_.navigatePage(0);
  });
};

/**
 * @param {string} href
 * @return {Promise}
 * @override
 */
EpubReaderCore.prototype.navigateHref = function(href) {
  var that = this;
  var hashIndex = href.indexOf('#');
  var path = hashIndex >= 0 ? href.substring(0, hashIndex) : href;
  var hash = hashIndex >= 0 ? href.substring(hashIndex) : '';

  return that.package_.getChapters().then(function(chapters) {
    var chapter = chapters.getByPath(path);
    if (!chapter) {
      return Promise.reject('Chapter ' + path + ' not found');
    }

    return that.renderChapter_(chapter);
  }).then(function() {
    return hash ?
        that.renderer_.navigateHash(hash) :
        that.renderer_.navigatePage(0);
  });
};

/**
 * Check can reader navigate next and prev.
 * @return {Promise.<object>}
 */
EpubReaderCore.prototype.canNavigatePrevOrNext = function() {
  var that = this;
  if (!that.currentChapter_) {
    return Promise.resolve({
      prev: false,
      next: false
    });
  }

  var currentChapterPage = that.renderer_.getCurrentPage();
  var currentChapterPages = that.renderer_.getPagesCount();
  var canNavigatePrevInCurrent = currentChapterPage > 0;
  var canNavigateNextInCurrent = currentChapterPage < currentChapterPages - 1;
  if (canNavigatePrevInCurrent && canNavigateNextInCurrent) {
    return Promise.resolve({
      prev: true,
      next: true
    });
  }

  return that.package_.getChapters().then(function(chapters) {
    var nextLinear = chapters.getNextLinearByChapter(that.currentChapter_);
    var prevLinear = chapters.getPrevLinearByChapter(that.currentChapter_);

    return {
      prev: canNavigatePrevInCurrent || !!prevLinear,
      next: canNavigateNextInCurrent || !!nextLinear
    };
  });
};

/**
 * Change current chapter.
 * @return {Promise}
 */
EpubReaderCore.prototype.renderChapter_ = function(chapter) {
  var that = this;
  if (chapter === that.currentChapter_) {
    return Promise.resolve();
  }

  that.currentChapter_ = chapter;
  return that.renderer_.renderDocument(chapter).then(function() {
    that.dispatchEvent_('documentChanged');
  });
};

/**
 * @return {Promise.<?string>}
 * @override
 */
EpubReaderCore.prototype.isCfiOnCurrentScreen = function(cfi) {
  if (!this.currentChapter_) {
    return Promise.resolve(false);
  }

  var chapterCfi = this.currentChapter_.getCfi();
  if (!chapterCfi) {
    return Promise.resolve(false);
  }

  var cfiSplit = cfi.split('!');
  var checkChapterCfi = cfiSplit[0];
  var checkDocumentCfi = cfiSplit[1];
  if (checkChapterCfi !== chapterCfi) {
    return Promise.resolve(false);
  }

  var result = this.renderer_.isCfiOnCurrentScreen(checkDocumentCfi);
  return Promise.resolve(result);
};

/**
 * @return {Promise.<?string>}
 * @override
 */
EpubReaderCore.prototype.calculateCurrentCfi_ = function() {
  var chapterCfi = this.currentChapter_.getCfi();
  var documentCfi = this.renderer_.getCurrentCfi();

  if (!chapterCfi || !documentCfi) {
    return Promise.resolve(null);
  }

  var joinedCfi = chapterCfi + '!' + documentCfi;
  return Promise.resolve(joinedCfi);
};

/**
 * @return {Promise}
 * @override
 */
EpubReaderCore.prototype.calculateCurrentProgress_ = function() {
  var that = this;
  return Promise.all([
    that.package_.getChapters(),
    that.chaptersMeasurer_.getChaptersSize(that.presentationOptions_)]
  ).then(function(results) {
    var page = that.renderer_.getCurrentPage();
    var chapters = results[0];
    var chaptersSize = results[1];
    var currentIndex = chapters.getChapterIndex(that.currentChapter_);

    return {
      unknown: false,
      currentPage: chaptersSize.getSizeBeforeChapter(currentIndex) + page + 1,
      totalPages: chaptersSize.getTotalSize()
    };
  }).catch(function(error) {
    // Handle cancellation error. Cancel error means that
    // this.chaptersMeasurer_.reset() was called while measuring chapters.
    // It can happen if window was resized while measuring chapters.
    if (error.message === 'cancelled') {
      return {
        unknown: true
      };
    }
    throw error;
  });
};

/**
 * @return {Promise}
 * @override
 */
EpubReaderCore.prototype.handleRendererNavigate_ = function(data) {
  var href = data.href;
  var options = data.options;
  if (/^(https?:\/)/.test(href)) {
    this.dispatchEvent_('navigateExternal', {
      href: href,
      options: options,
    });
    return Promise.resolve();
  }

  if (!this.currentChapter_) {
    return Promise.reject('Can not handle navigate if no current chapter');
  }

  var currentFolder = paths.folder(
      this.currentChapter_.getManifestItem().getHref());
  href = paths.resolve(currentFolder, href);
  return this.navigateHref(href);
};

/**
 * @override
 */
EpubReaderCore.prototype.resetCurrentProgressData_ = function() {
  var that = this;
  return EpubReaderCore.superclass
      .resetCurrentProgressData_.apply(that, arguments)
      .then(function() {
        that.chaptersMeasurer_.reset();
      });
};

/**
 * @override
 */
EpubReaderCore.prototype.dispose = function() {
  EpubReaderCore.superclass.dispose.apply(this, arguments);

  this.chaptersMeasurer_.dispose();

  this.chaptersMeasurer_ = null;
};

/**
 * Reload book.
 * @return {Promise}
 */
EpubReaderCore.prototype.reload = function() {
  this.currentChapter_ = null;
  return this.navigateBookStart();
};

/**
 * Create reader core.
 * @param {!Object} options
 * @return {Promise.<EpubReaderCore>}
 * @static
 */
EpubReaderCore.create = function(options) {
  return EpubPackage.openBookFromUrl(options.streamUrl)
      .then(function(epubPackage) {
        return Promise.all([
              ReaderCore.createRenderer(options.container),
              EpubChaptersMeasurer.create(epubPackage, options.container)])
            .then(function(result) {
              var flippingPageRenderer = result[0];
              var chaptersMeasurer = result[1];

              return new EpubReaderCore(
                  epubPackage, flippingPageRenderer, chaptersMeasurer);
            });
      });
};

// Exports.
module.exports = EpubReaderCore;

},{"../../common/core":6,"../../common/paths":9,"../../parser/epub/epub_package":25,"../../render/page/flipping_page_renderer":46,"../base/reader_core":37,"./epub_chapters_measurer":38,"./epub_renderer.css":41}],41:[function(require,module,exports){
module.exports = ".reader-renderer--scrollable {\n  width: 60%;\n  margin: 0 auto;\n}\n";

},{}],42:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

// Dependencies.
var core = require('../../common/core');
var Fb2Package = require('../../parser/fb2/fb2_package');
var ReaderCore = require('../base/reader_core');
var fb2RendererCss = require('./fb2_renderer.css');

/**
 * Reader fb2 core object.
 * @param {!Fb2Package} fb2Package
 * @param {!FlippingPageRenderer} renderer
 * @extends {ReaderCore}
 * @constructor
 */
function Fb2ReaderCore(fb2Package, renderer) {
  Fb2ReaderCore.superclass.constructor.apply(this, [fb2Package, renderer]);
}
core.extend(Fb2ReaderCore, ReaderCore);

/**
 * Ensure book rendered.
 * @private
 */
Fb2ReaderCore.prototype.ensureBookRendered_ = function() {
  var that = this;
  if (that.currentDocument_) {
    return Promise.resolve();
  }

  return this.package_.getDocument().then(function(bookDocument) {
    that.currentDocument_ = bookDocument;
    return that.renderer_.renderDocument(that.currentDocument_);
  });
};

/**
 * Listen for renderer events.
 * @override
 */
Fb2ReaderCore.prototype.setupRenderer_ = function() {
  Fb2ReaderCore.superclass.setupRenderer_.apply(this);
  this.renderer_.injectStyle(fb2RendererCss);
}

/**
 * @return {Promise}
 * @override
 */
Fb2ReaderCore.prototype.navigateBookStart = function() {
  var that = this;

  return this.ensureBookRendered_().then(function() {
    return that.renderer_.navigatePage(0);
  });
};

/**
 * @return {Promise}
 * @override
 */
Fb2ReaderCore.prototype.navigateBookEnd = function() {
  var that = this;

  return this.ensureBookRendered_().then(function() {
    var totalPages = that.renderer_.getPagesCount();
    return that.renderer_.navigatePage(totalPages);
  });
};

/**
 * @param {string} cfi
 * @return {Promise}
 */
Fb2ReaderCore.prototype.navigateCfi = function(cfi) {
  var that = this;

  return that.ensureBookRendered_().then(function() {
    return that.renderer_.navigateCfi(cfi);
  });
};

/**
 * @return {Promise}
 * @override
 */
Fb2ReaderCore.prototype.navigateNextPage = function() {
  var that = this;
  if (!that.currentDocument_) {
    return Promise.reject('Please use some absolute navigation first. ' +
        'For example navigateBookStart or navigateHref.');
  }

  var nextPage = that.renderer_.getCurrentPage() + 1;
  var totalPages = that.renderer_.getPagesCount();
  if (nextPage >= totalPages) {
    return Promise.reject('No next page exists');
  }

  return that.renderer_.navigatePage(nextPage);
};

/**
 * @return {Promise}
 * @override
 */
Fb2ReaderCore.prototype.navigatePrevPage = function() {
  var that = this;
  if (!that.currentDocument_) {
    return Promise.reject('Please use some absolute navigation first. ' +
        'For example navigateBookStart or navigateHref.');
  }

  var nextPage = that.renderer_.getCurrentPage() - 1;
  if (nextPage < 0) {
    return Promise.reject('No prev page exists');
  }
  return that.renderer_.navigatePage(nextPage);
};

/**
 * @param {string} href
 * @return {Promise}
 * @override
 */
Fb2ReaderCore.prototype.navigateHref = function(href) {
  var that = this;
  if (href[0] !== '#') {
    return Promise.reject('Cannot navigate to ' + href + '. ' +
        'Fb2ReaderCore can navigate only hash links.');
  }

  return this.ensureBookRendered_().then(function() {
    return that.renderer_.navigateHash(href);
  });
};

/**
 * Check can reader navigate next and prev.
 * @return {Promise.<object>}
 */
Fb2ReaderCore.prototype.canNavigatePrevOrNext = function() {
  if (!this.currentDocument_) {
    return Promise.resolve({
      prev: false,
      next: false
    });
  }

  var currentChapterPage = this.renderer_.getCurrentPage();
  var currentChapterPages = this.renderer_.getPagesCount();
  return Promise.resolve({
    prev: currentChapterPage > 0,
    next: currentChapterPage < currentChapterPages - 1
  });
};

/**
 * @return {Promise.<?string>}
 * @override
 */
Fb2ReaderCore.prototype.isCfiOnCurrentScreen = function(cfi) {
  var result = this.renderer_.isCfiOnCurrentScreen(cfi);

  return Promise.resolve(result);
};

/**
 * @return {Promise.<?string>}
 * @override
 */
Fb2ReaderCore.prototype.calculateCurrentCfi_ = function() {
  var cfi = this.renderer_.getCurrentCfi();

  return Promise.resolve(cfi);
};

/**
 * @return {Promise}
 * @override
 */
Fb2ReaderCore.prototype.calculateCurrentProgress_ = function() {
  var progress = {
    unknown: false,
    currentPage: this.renderer_.getCurrentPage() + 1,
    totalPages: this.renderer_.getPagesCount()
  };

  return Promise.resolve(progress);
};

/**
 * @return {Promise}
 * @override
 */
Fb2ReaderCore.prototype.handleRendererNavigate_ = function(data) {
  var href = data.href;
  var options = data.options;
  if (/^(https?:\/)/.test(href)) {
    this.dispatchEvent_('navigateExternal', {
      href: href,
      options: options,
    });
    return Promise.resolve();
  }

  return this.navigateHref(href);
};

/**
 * Reload book.
 * @return {Promise}
 */
Fb2ReaderCore.prototype.reload = function() {
  this.currentDocument_ = null;
  return this.navigateBookStart();
};

/**
 * Create reader core with provided package.
 * @param {Fb2Package} fb2Package
 * @param {Element} container
 * @return {Promise.<Fb2ReaderCore>}
 * @static
 * @private
 */
Fb2ReaderCore.create_ = function(fb2Package, container) {
  return ReaderCore.createRenderer(container).then(function(pageRenderer) {
    return new Fb2ReaderCore(fb2Package, pageRenderer);
  });
};

/**
 * Create reader core from plain fb2 url.
 * @param {!Object} options
 * @return {Promise.<Fb2ReaderCore>}
 * @static
 */
Fb2ReaderCore.createPlain = function(options) {
  return Fb2Package.openBookFromPlainUrl(options.streamUrl)
      .then(function(fb2Package) {
        return Fb2ReaderCore.create_(fb2Package, options.container);
      });
};

/**
 * Create reader core from fb2.zip url.
 * @param {!Object} options
 * @return {Promise.<Fb2ReaderCore>}
 * @static
 */
Fb2ReaderCore.createZip = function(options) {
  return Fb2Package.openBookFromZipUrl(options.streamUrl)
      .then(function(fb2Package) {
        return Fb2ReaderCore.create_(fb2Package, options.container);
      });
};

// Exports.
module.exports = Fb2ReaderCore;

},{"../../common/core":6,"../../parser/fb2/fb2_package":33,"../base/reader_core":37,"./fb2_renderer.css":43}],43:[function(require,module,exports){
module.exports = "h1, h2, h3, h4, h5, h6 {\n  margin: 77px 0 28px;\n\n  text-align: center;\n}\n\nh1 {\n  font-size: 300%;\n}\n\nh2 {\n  font-size: 220%;\n}\n\nh3 {\n  font-size: 180%;\n}\n\nh4 {\n  font-size: 130%;\n}\n\nh5 {\n  font-size: 120%;\n}\n\nh6 {\n  font-size: 95%;\n}\n\np {\n  margin: 0 0 28px;\n}\n\n.reader-renderer--scrollable {\n  width: 60%;\n  margin: 0 auto;\n  text-align: center;\n}\n\n.reader-renderer--scrollable p {\n  margin: 0 0 32px;\n  text-align: left;\n}\n\nsub, sup {\n  font-size: 50%;\n}\n\nblockquote {\n  margin: 0 0 28px;\n}\n\n.reader-parser--epigraph, .reader-parser--cite {\n  font-style: italic;\n}\n\n.reader-parser--poem {\n  text-align: center;\n}\n\ncode {\n  font-weight: bold;\n}\n";

},{}],44:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

// Dependencies.
var Cfi = require('../../common/cfi');
var core = require('../../common/core');
var EventEmitter = require('../../common/event_emitter');
var resourceLoadUtils = require('./resource_load_utils');
var ReaderCursor = require('../../common/reader_cursor');
var xmlUtils = require('../../common/xml_utils');

/**
 * Copy all children from one element to another.
 * @param {!Element} fromElement
 * @param {!Element} toElement
 */
function copyChildren(fromElement, toElement) {
  for (var i = 0; i < fromElement.childElementCount; i++) {
    toElement.appendChild(fromElement.children[i].cloneNode(true));
  }
}

/**
 * Book chapter renderer.
 * @param {!Element} container
 * @constructor
 */
function Renderer(container) {
  Renderer.superclass.constructor.apply(this);

  this.container_ = container;

  this.container_.style.position = 'relative';

  this.iframe_ = this.createIframe_();
  this.container_.appendChild(this.iframe_);
  this.iframeWindow_ = this.iframe_.contentWindow;
  this.iframeDocument_ = this.iframeWindow_.document;

  this.currentPageElement_ = null;
  this.visibleElements_ = [];
}

core.extend(Renderer, EventEmitter);

/**
 * Creates new iframe in container.
 * @return {Element}
 * @virtual
 * @private
 */
Renderer.prototype.createIframe_ = function() {
  var iframe = document.createElement('iframe');
  iframe.sandbox = 'allow-same-origin allow-scripts';
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = 'none';

  return iframe;
};

/**
 * Inject renderer styles to iframe.
 */
Renderer.prototype.injectStyle = function(stylesText) {
  var styleElement = this.iframeDocument_.createElement('style');
  styleElement.classList.add('renderer-injected-styles');
  styleElement.innerHTML = stylesText;
  this.iframeDocument_.head.appendChild(styleElement);
};

/**
 * Render document in current iframe.
 * @param {BookDocument} bookDocument
 * @return {Promise}
 * @virtual
 */
Renderer.prototype.renderDocument = function(bookDocument) {
  var that = this;
  that.clear();

  return bookDocument.getDocumentHtml().then(function(bookHtml) {
    copyChildren(bookHtml.head, that.iframeDocument_.head);
    copyChildren(bookHtml.body, that.iframeDocument_.body);

    return Promise.all([
      resourceLoadUtils.waitAllStylesLoaded(that.iframeDocument_.head, 1000),
      resourceLoadUtils.waitAllImagesLoaded(that.iframeDocument_.body, 1000)
    ])
    .then(function() {
      that.buildVisibleElementsList_();
      that.updateFirstVisibleElement_();
    });
  });
};

/**
 * Set presentation options.
 * @param {Object} options
 * @virtual
 */
Renderer.prototype.setPresentationOptions = function(options) {
  this.iframeDocument_.body.style.fontFamily = options.fontFamily;
  this.iframeDocument_.body.style.fontSize = options.fontSize + 'px';
};

/**
 * Clear iframe document.
 */
Renderer.prototype.clear = function() {
  Array.prototype.slice.call(this.iframeDocument_.head.children)
      .filter(function(child) {
        return !child.classList.contains('renderer-injected-styles');
      })
      .forEach(function(child) {
        child.remove();
      });

  while (this.iframeDocument_.body.lastElementChild) {
    this.iframeDocument_.body.lastElementChild.remove();
  }
};

/**
 * Destroy renderer object and free all internal resources.
 * @virtual
 */
Renderer.prototype.dispose = function() {
  Renderer.superclass.dispose.apply(this, arguments);
  this.container_.removeChild(this.iframe_);

  this.iframe_ = null;
  this.container_ = null;
  this.currentPageElement_ = null;
  this.visibleElements_ = null;
};

/**
 * Get container.
 * @return {!Element}
 */
Renderer.prototype.getContainer = function() {
  return this.container_;
};

/**
 * Create renderer with provided container element.
 * @param {!Element} containerElement
 * @return {Promise.<Renderer>}
 * @static
 */
Renderer.create = function(containerElement) {
  return Promise.resolve(new Renderer(containerElement));
};

/**
 * Handle iframe body click.
 * @param {!Event} event
 * @private
 */
Renderer.prototype.handleIframeBodyClick_ = function(event) {
  var link = event.composedPath().filter(function(element) {
    return element.tagName && element.tagName.toLowerCase() === 'a';
  })[0];

  if (link) {
    event.preventDefault();
    event.stopPropagation();

    var href = link.getAttribute('href');

    if (!href) {
      return;
    }

    if (href[0] !== '#') {
      this.dispatchEvent_('navigate', {
        href: href,
        options: {
          altKey: event.altKey,
          button: event.button,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
        },
      });
    }
    else {
      this.navigateHash(href);
    }
  }
};

/**
 * Get element by cfi.
 * @param {string} cfi
 * @return {HTMLElement}
 * @private
 */
Renderer.prototype.getElementByCfi_ = function(cfi) {
  var cfiString = Cfi.parseFromString(cfi).toString();
  return xmlUtils.getFirstMatchBySelector(this.iframeDocument_.body, [
    '[' + Renderer.CFI_ATTRIBUTE + '="' + cfiString + '"]'
  ]);
};

/**
 * Navigate to cfi.
 * @param {string} cfi
 * @return {Promise}
 */
Renderer.prototype.navigateCfi = function(cfi) {
  var that = this;
  var element = that.getElementByCfi_(cfi);
  if (!element) {
    return Promise.reject('No element for cfi ' + cfi.toString() + ' found');
  }
  return this.navigateElement_(element);
};

Renderer.prototype.navigateElement_ = function(element) {
  var that = this;
  var elementPage = that.getElementPage_(element);
  return that.navigatePage(elementPage).then(function() {
    that.currentPageElement_ = element;
  });
};

/**
 * Get renderer current cfi.
 * @return {?string}
 */
Renderer.prototype.getCurrentCfi = function() {
  if (!this.currentPageElement_) {
    return null;
  }

  var element = this.currentPageElement_;
  var cfiString;
  do {
    cfiString = element.getAttribute(Renderer.CFI_ATTRIBUTE);
    element = element.parentElement;
  } while (!cfiString && element);

  return cfiString;
};

/**
 * Get renderer current page.
 * @return {string}
 */
Renderer.prototype.getCurrentTextFragment = function() {
  if (!this.currentPageElement_) {
    return '';
  }

  return this.currentPageElement_.textContent;
};

/**
 * Check if provided cfi is currently on screen.
 * @param {string} cfi
 * @return {boolean}
 */
Renderer.prototype.isCfiOnCurrentScreen = function(cfi) {
  var element = this.getElementByCfi_(cfi);
  if (!element) {
    return false;
  }

  var bcr = element.getBoundingClientRect();
  return bcr.left >= 0 &&
      bcr.left <= this.iframeDocument_.body.clientWidth &&
      bcr.top >= 0 &&
      bcr.top <= this.iframeDocument_.body.clientHeight;
};

/**
 * @return {Promise.<ReaderCursor>}
 */
Renderer.prototype.createCursor = function() {
  var that = this;
  var index = this.visibleElements_.indexOf(this.currentPageElement_);
  var result = new ReaderCursor(function() {
    if (index >= that.visibleElements_.length) {
      result.close();
      return Promise.resolve(null);
    }
    var element = that.visibleElements_[index];
    var onCurrentPage =
        element.getBoundingClientRect().left < that.iframeWindow_.left / 2 ?
        1 :
        Math.min((that.iframeWindow_.innerHeight - element.offsetTop) /
                 element.offsetHeight, 1);
    index++;
    var prerender = that.visibleElements_.slice(index, index + 5);
    return that.navigateElement_(element).then(function() {
      return {
        value: element,
        onCurrentPage: onCurrentPage,
        prerender: prerender,
      };
    });
  });
  return Promise.resolve(result);
};

/**
 * @private
 */
Renderer.prototype.updateFirstVisibleElement_ = function() {
  var that = this;

  /**
   * @param {!Element} first
   * @param {!Element} last
   * @return {!Element}
   */
  var searchElementRecursively = function(first, last) {
    if (first >= last - 1) {
      return that.visibleElements_[last];
    }

    var middle = Math.ceil(first + Math.ceil((last - first) / 2));

    var firstBcr = that.visibleElements_[first].getBoundingClientRect();
    var middleBcr = that.visibleElements_[middle].getBoundingClientRect();

    var firstIsBeforeScreen = firstBcr.left < 0 || firstBcr.top < 0;
    var middleIsBeforeScreen = middleBcr.left < 0 || middleBcr.top < 0;

    if (!firstIsBeforeScreen && !middleIsBeforeScreen) {
      return that.visibleElements_[first];
    } else if (firstIsBeforeScreen && !middleIsBeforeScreen) {
      return searchElementRecursively(first, middle);
    } else {
      return searchElementRecursively(middle, last);
    }
  };

  that.currentPageElement_ = searchElementRecursively(
      0, that.visibleElements_.length - 1);
};

/**
 * Scroll to currently visible element.
 * @private
 */
Renderer.prototype.scrollToCurrentElement_ = function() {
  if (!this.currentPageElement_) {
    return;
  }

  var pageNumber = this.getElementPage_(this.currentPageElement_);
  this.changePage_(pageNumber);
};

/**
 * Ensure that column count is even.
 * @private
 */
Renderer.prototype.buildVisibleElementsList_ = function() {
  this.visibleElements_ = [];

  var nodeIterator = document.createNodeIterator(
      this.iframeDocument_.body,
      NodeFilter.SHOW_ELEMENT);

  var element;
  while (element = nodeIterator.nextNode()) {
    if (element.childElementCount === 0 &&
        element.offsetWidth > 0 &&
        element.offsetHeight > 0) {
      this.visibleElements_.push(element);
    }
  }
};

/**
 * @type {string}
 * @const
 */
Renderer.CFI_ATTRIBUTE = 'reader-parser--cfi';

// Exports.
module.exports = Renderer;

},{"../../common/cfi":3,"../../common/core":6,"../../common/event_emitter":7,"../../common/reader_cursor":10,"../../common/xml_utils":13,"./resource_load_utils":45}],45:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

/**
 * Wait for load or error event on provided element.
 * @param {HTMLElement} element
 * @param {number} timeoutMilliseconds
 * @return {Promise}
 */
var waitForLoadOrErrorEvent = function(element, timeoutMilliseconds) {
  return new Promise(function(resolve) {
    var timeoutId;
    var handleLoad = function() {
      element.removeEventListener('load', handleLoad);
      element.removeEventListener('error', handleLoad);
      clearTimeout(timeoutId);
      resolve();
    };
    element.addEventListener('load', handleLoad);
    element.addEventListener('error', handleLoad);
    timeoutId = setTimeout(handleLoad, timeoutMilliseconds);
  });
};

/**
 * Wait until image loaded.
 * @param {HTMLElement} image
 * @param {number} timeoutMilliseconds
 */
var waiForImageLoaded = function(image, timeoutMilliseconds) {
  if (image.complete || !image.src || image.src === location.href) {
    return Promise.resolve();
  }

  return waitForLoadOrErrorEvent(image, timeoutMilliseconds);
};

/**
 * Wait until all svg images loaded.
 * @param {HTMLElement} image
 * @param {number} timeoutMilliseconds
 * @return {Promise}
 */
var waitForSvgImageLoaded = function(image, timeoutMilliseconds) {
  var svgImages = image.querySelectorAll('image');
  var svgImagesPromises = [];
  var i;

  for (i = 0; i < svgImages.length; i++) {
    svgImagesPromises.push(
        waiForImageLoaded(svgImages[i], timeoutMilliseconds));
  }

  return Promise.all(svgImagesPromises);
};

/**
 * Wait until style loaded.
 * @param {HTMLElement} style
 * @param {number} timeoutMilliseconds
 * @return {Promise}
 */
var waitForStyleLoaded = function(style, timeoutMilliseconds) {
  if (!style.href || style.href === location.href) {
    return Promise.resolve();
  }

  var documentStylesheets = style.ownerDocument.styleSheets;
  var i;
  for (i = 0; i < documentStylesheets.length; i++) {
    if (documentStylesheets[i].href === style.href) {
      return Promise.resolve();
    }
  }

  return waitForLoadOrErrorEvent(style, timeoutMilliseconds);
};

/**
 * Wait until all styles loaded.
 * @param {HTMLElement} rootElement
 * @param {number} timeoutMilliseconds
 * @return {Promise}
 */
var waitAllStylesLoaded = function(rootElement, timeoutMilliseconds) {
  var styles = rootElement.querySelectorAll('link[rel=stylesheet]');
  var stylesPromises = [];
  var i;
  for (i = 0; i < styles.length; i++) {
    stylesPromises.push(waitForStyleLoaded(styles[i], timeoutMilliseconds));
  }

  return Promise.all(stylesPromises);
};

/**
 * Wait until all images loaded.
 * @param {HTMLElement} rootElement
 * @param {number} timeoutMilliseconds
 * @return {Promise}
 */
var waitAllImagesLoaded = function(rootElement, timeoutMilliseconds) {
  var images = rootElement.querySelectorAll('img,svg');
  var imagesPromises = [];
  var i;
  for (i = 0; i < images.length; i++) {
    imagesPromises.push(images[i].nodeName.toLowerCase() === 'svg' ?
        waitForSvgImageLoaded(images[i], timeoutMilliseconds) :
        waiForImageLoaded(images[i], timeoutMilliseconds));
  }

  return Promise.all(imagesPromises);
};

// Exports.
module.exports = {
  waitAllImagesLoaded: waitAllImagesLoaded,
  waitAllStylesLoaded: waitAllStylesLoaded
};

},{}],46:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

// Dependencies.
var asyncUtils = require('../../common/async_utils');
var core = require('../../common/core');
var PageRenderer = require('./page_renderer');
var xmlUtils = require('../../common/xml_utils');

/**
 * Hidden book chapter renderer.
 * @param {!Element} container
 * @extends {PageRenderer}
 * @constructor
 */
function FlippingPageRenderer (container) {
  FlippingPageRenderer.superclass.constructor.apply(this, arguments);

  this.relayoutDocumentDelayed_ = asyncUtils.delay(this.relayoutDocument_, 200);
  this.currentPage = 0;

  var that = this;
  this.iframeDocument_.body.addEventListener('click', function(event) {
    that.handleIframeBodyClick_(event);
  });
  this.iframeWindow_.addEventListener('wheel', function(event) {
    that.handleWheelEvent_(event);
  }, {passive: false});
  this.iframeWindow_.addEventListener('scroll', function() {
    that.handleScrollEvent_();
  });
  this.iframeWindow_.addEventListener('resize', function() {
    that.handleIframeWindowResize_();
  });
  this.iframeWindow_.addEventListener('keydown', function(e) {
    that.dispatchEvent_('bookKeydown', e);
  });
}
core.extend(FlippingPageRenderer, PageRenderer);

/**
 * @override
 */
FlippingPageRenderer.prototype.renderDocument = function(bookDocument) {
  var that = this;

  return FlippingPageRenderer.superclass
      .renderDocument.apply(this, arguments)
      .then(function() {
        that.layoutColumns_();
      });
};

/**
 * @override
 */
FlippingPageRenderer.prototype.setPresentationOptions = function(size) {
  FlippingPageRenderer.superclass.setPresentationOptions.apply(this, arguments);

  this.relayoutDocument_();
};

/**
 * Navigate to url #hash.
 * @param {string} hash
 * @return {Promise}
 */
FlippingPageRenderer.prototype.navigateHash = function(hash) {
  var that = this;
  if (hash[0] === '#') {
    hash = hash.substring(1);
  }

  var element = xmlUtils.getFirstMatchBySelector(that.iframeDocument_.body, [
    'a[name="' + hash + '"]',
    '[id="' + hash + '"]'
  ]);
  if (!element) {
    return Promise.reject('No element for hash ' + hash + ' found');
  }

  var elementPage = that.getElementPage_(element);
  return that.changePage_(elementPage).then(function() {
    that.updateFirstVisibleElement_();
  });
};

/**
 * Change current page.
 * @param {number} pageNumber
 * @return {Promise}
 * @private
 */
FlippingPageRenderer.prototype.changePage_ = function(pageNumber) {
  this.currentPage = pageNumber;
  this.iframeDocument_.body.scrollLeft = this.getPageWidth_() * pageNumber;
  this.dispatchEvent_('pageChanged', {page: this.getCurrentPage()});
  return Promise.resolve();
};

/**
 * Navigate to page.
 * @param {number} pageNumber
 * @return {Promise}
 */
FlippingPageRenderer.prototype.navigatePage = function(pageNumber) {
  var that = this;
  return this.changePage_(pageNumber).then(function() {
    that.updateFirstVisibleElement_();
  });
};

/**
 * Get renderer current page.
 * @return {number}
 */
FlippingPageRenderer.prototype.getCurrentPage = function() {
  return Math.round(
      this.iframeDocument_.body.scrollLeft / this.getPageWidth_());
};

/**
 * Find element page.
 * @param {Element} element
 * @return {number}
 */
FlippingPageRenderer.prototype.getElementPage_ = function(element) {
  var elementOffset = this.iframeDocument_.body.scrollLeft +
      Math.floor(element.getBoundingClientRect().left);
  return Math.floor(elementOffset / this.getPageWidth_());
};

/**
 * Ensure that column count is even.
 * @private
 */
FlippingPageRenderer.prototype.ensureColumnCountIsEven_ = function() {
  var columnCount = this.getColumnCount_();
  if (columnCount % 2 === 0) {
    return;
  }

  var columnBreaker = this.iframeDocument_.body
      .querySelector('#reader-renderer--last-column-breaker');
  if (columnBreaker) {
    columnBreaker.remove();
  } else {
    columnBreaker = this.iframeDocument_.createElement('div');
    columnBreaker.id = 'reader-renderer--last-column-breaker';
    columnBreaker.innerHTML = '&nbsp;';
    this.iframeDocument_.body.appendChild(columnBreaker);
  }
};

/**
 * @private
 */
FlippingPageRenderer.prototype.ensureSingleColumnLayout_ = function() {
  var columnBreaker = this.iframeDocument_.body
      .querySelector('#reader-renderer--last-column-breaker');
  if (columnBreaker) {
    columnBreaker.remove();
  }
};

FlippingPageRenderer.prototype.layoutColumns_ = function() {
  if (this.getColumnsPerPage_() > 1) {
    this.ensureColumnCountIsEven_();
  } else {
    this.ensureSingleColumnLayout_();
  }
};

FlippingPageRenderer.prototype.relayoutDocument_ = function() {
  this.layoutColumns_();
  this.scrollToCurrentElement_();
};

/**
* @private
*/
FlippingPageRenderer.prototype.handleWheelEvent_ = function(event) {
  event.preventDefault();
};

/**
 * When user searches on page we must ensure that
 * there is always only one page in frame.
 * @return {Promise}
 * @private
 */
FlippingPageRenderer.prototype.handleScrollEvent_ = async function() {
  if (this.currentPage !== this.getCurrentPage()) {
    await this.changePage_(this.getCurrentPage());
    this.updateFirstVisibleElement_();
  }
  return Promise.resolve();
};

/**
 * @override
 */
FlippingPageRenderer.prototype.handleIframeWindowResize_ = function() {
  FlippingPageRenderer.superclass
      .handleIframeWindowResize_.apply(this, arguments);
  this.dispatchEvent_('resize');
  this.relayoutDocumentDelayed_();
};

/**
 * Create renderer with provided container element.
 * @param {!Element} containerElement
 * @return {Promise.<FlippingPageRenderer>}
 * @static
 */
FlippingPageRenderer.create = function(containerElement) {
  return Promise.resolve(new FlippingPageRenderer(containerElement));
};

module.exports = FlippingPageRenderer;

},{"../../common/async_utils":1,"../../common/core":6,"../../common/xml_utils":13,"./page_renderer":49}],47:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

// Dependencies.
var core = require('../../common/core');
var PageRenderer = require('./page_renderer');

/**
 * Hidden book chapter renderer.
 * @param {!Element} container
 * @extends {PageRenderer}
 * @constructor
 */
function MeasurePageRenderer (container) {
  MeasurePageRenderer.superclass.constructor.apply(this, arguments);
}
core.extend(MeasurePageRenderer, PageRenderer);

/**
 * @override
 */
MeasurePageRenderer.prototype.createIframe_ = function() {
  var iframe = MeasurePageRenderer.superclass
      .createIframe_.apply(this, arguments);

  iframe.style.position = 'absolute';
  iframe.style.left = 0;
  iframe.style.top = 0;
  iframe.style.visibility = 'hidden';
  iframe.style.zIndex = -1;

  return iframe;
};


/**
 * Create renderer with provided container element.
 * @param {!Element} containerElement
 * @return {Promise.<MeasurePageRenderer>}
 * @static
 */
MeasurePageRenderer.create = function(containerElement) {
  return Promise.resolve(new MeasurePageRenderer(containerElement));
};

module.exports = MeasurePageRenderer;

},{"../../common/core":6,"./page_renderer":49}],48:[function(require,module,exports){
module.exports = "/* Copyright (c) 2015 Yandex LLC. All rights reserved.\n * Author: Dmitry Guketlev <yavanosta@yandex-team.ru> */\n\nbody {\n height: 100% !important;;\n margin: 0 !important;;\n padding: 0 !important;;\n\n column-gap: 28px !important;;\n column-count: 2 !important;;\n}\n\n/* hide scrollbar */\n::-webkit-scrollbar {\n  width: 0px;\n  display: none;\n}\n\n.single-column {\n column-gap: 0 !important;;\n column-count: 1 !important;;\n}\n\n#reader-renderer--last-column-breaker {\n  -webkit-column-break-before: always !important;;\n break-before: column !important;;\n}\n\nimg {\n  max-width: calc(50vw - 25px) !important;\n max-height: 95vh !important;\n\n  -webkit-column-break-inside: avoid !important;;\n break-inside: avoid-column !important;;\n}\n";

},{}],49:[function(require,module,exports){
// Copyright (c) 2015 Yandex LLC. All rights reserved.
// Author: Dmitry Guketlev <yavanosta@yandex-team.ru>

'use strict';

// Dependencies.
var core = require('../../common/core');
var pageRendererCss = require('./page_renderer.css');
var Renderer = require('../base/renderer');

/**
 * Width of gap between columns.
 * @type {number}
 */
var GAP_WIDTH = 28;

/**
 * @type {number}
 */
var MAX_TWO_COLUMN_PAGE_WIDTH = 600;

/**
 * Hidden book chapter renderer.
 * @param {!Element} container
 * @extends {Renderer}
 * @constructor
 */
function PageRenderer(container) {
  PageRenderer.superclass.constructor.apply(this, arguments);

  this.injectStyle(pageRendererCss);

  this.switchColumnLayout_();
}
core.extend(PageRenderer, Renderer);

/**
 * @private
 */
PageRenderer.prototype.handleIframeWindowResize_ = function() {
  this.switchColumnLayout_();
}

PageRenderer.prototype.getDocumentWidth_ = function() {
  return this.iframeDocument_.body.getBoundingClientRect().width;
};

/**
 * @private
 * @return {number}
 */
PageRenderer.prototype.getGapWidth_ = function() {
  return this.isSingleColumn_ ? 0 : GAP_WIDTH;
};

/**
 * Return page width.
 * @return {number}
 * @private
 */
PageRenderer.prototype.getPageWidth_ = function() {
  return this.getDocumentWidth_() + this.getGapWidth_();
};

/**
 * @return {number}
 * @private
 */
PageRenderer.prototype.getColumnsPerPage_ = function() {
  return this.isSingleColumn_ ? 1 : 2;
}

/**
 * Calculate current column count.
 * @return {number}
 * @private
 */
PageRenderer.prototype.getColumnCount_ = function() {
  var totalWidth = this.iframeDocument_.body.scrollWidth;
  var gapWidth = this.getGapWidth_();
  var columnWidth = (this.getDocumentWidth_() - gapWidth) /
                    this.getColumnsPerPage_();
  return Math.round((totalWidth - columnWidth) / (gapWidth + columnWidth) + 1);
};

/**
 * Get renderer page count.
 * @return {number}
 */
PageRenderer.prototype.getPagesCount = function() {
  return Math.ceil(this.getColumnCount_() / this.getColumnsPerPage_());
};

/**
 * Switch single/double column layout.
 * @private
 */
PageRenderer.prototype.switchColumnLayout_ = function() {
  if (this.getDocumentWidth_() < MAX_TWO_COLUMN_PAGE_WIDTH) {
    this.isSingleColumn_ = true;
    this.iframeDocument_.body.classList.add('single-column');
  } else {
    this.isSingleColumn_ = false;
    this.iframeDocument_.body.classList.remove('single-column');
  }
};

/**
 * Create renderer with provided container element.
 * @param {!Element} containerElement
 * @return {Promise.<PageRenderer>}
 * @static
 */
PageRenderer.create = function(containerElement) {
  return Promise.resolve(new PageRenderer(containerElement));
};

module.exports = PageRenderer;

},{"../../common/core":6,"../base/renderer":44,"./page_renderer.css":48}],50:[function(require,module,exports){
module.exports = "/* Copyright (c) 2017 Yandex LLC. All rights reserved.\n * Author: Anton Permyakov <tonynasta@yandex-team.ru> */\n\nbody {\n  will-change: transform;\n}\n";

},{}],51:[function(require,module,exports){
// Copyright (c) 2017 Yandex LLC. All rights reserved.
// Author: Anton Permyakov <tonynasta@yandex-team.ru>

'use strict';

var core = require('../../common/core');
var Renderer = require('../base/renderer');
var scrollPageRendererCss = require('./scroll_page_renderer.css');

/**
 * Scroll renderer.
 *
 * @param {!Element} container
 * @extends {Renderer}
 * @constructor
 */
function ScrollRenderer(element) {
  ScrollRenderer.superclass.constructor.apply(this, arguments);

  this.pageHeight_ = this.iframeWindow_.innerHeight;
  this.currentScroll_ = this.iframeWindow_.scrollY;

  this.totalPages_ = 0;
  this.currentPage_ = 0;

  this.currentPage_ = 0;
  this.nextPageOffset_ = this.pageHeight_;
  this.prevPageOffset_ = 0;

  var that = this;

  this.iframeWindow_.addEventListener('scroll', function() {
    that.handleScrollEvent_();
  });

  this.iframeWindow_.addEventListener('resize', function() {
    that.recalculateLayout_();
  });

  this.iframeDocument_.body.addEventListener('click', function(event) {
    that.handleIframeBodyClick_(event);
  });

  this.iframeWindow_.addEventListener('keydown', function(e) {
    that.dispatchEvent_('bookKeydown', e);
  });

  this.injectStyle(scrollPageRendererCss);

  this.iframeDocument_.body.classList.add('reader-renderer--scrollable');
}

core.extend(ScrollRenderer, Renderer);

/**
 * Navigate to url #hash.
 * @param {string} hash
 * @return {Promise}
 */
ScrollRenderer.prototype.navigateHash = function(hash) {
  this.iframeWindow_.location.hash = hash;
  return Promise.resolve();
}

/**
 * Render document in current iframe.
 * @param {BookDocument} bookDocument
 * @return {Promise}
 */
ScrollRenderer.prototype.renderDocument = function(bookDocument) {
  var that = this;
  return ScrollRenderer.superclass.renderDocument.apply(this, arguments)
      .then(function() {
        that.recalculateLayout_()
      });
}

/**
 * @private
 */
ScrollRenderer.prototype.recalculateLayout_ = function() {
  this.pageHeight_ = this.iframeWindow_.innerHeight;
  this.currentScroll_ = this.iframeWindow_.scrollY;
  this.totalScroll_ = this.iframeDocument_.body.scrollHeight;
  this.lastPageOffset_ = this.totalScroll_ - this.pageHeight_;
  this.totalPages_ = Math.ceil(this.totalScroll_ / this.pageHeight_);

  this.recalculateMeasures_();
  this.updateFirstVisibleElement_();
  this.dispatchEvent_('pageChanged');
}

/**
 * @private
 */
ScrollRenderer.prototype.handleScrollEvent_ = function() {
  this.currentScroll_ = this.iframeWindow_.scrollY;

  if (this.currentScroll_ < this.prevPageOffset_ ||
      this.currentScroll_ >= this.nextPageOffset_ ||
      this.currentScroll_ === this.lastPageOffset_) {

    this.recalculateMeasures_();
    this.updateFirstVisibleElement_();
    this.dispatchEvent_('pageChanged');
  }
}

/**
 * @private
 */
ScrollRenderer.prototype.recalculateMeasures_ = function() {
  this.currentPage_ = this.currentScroll_ === this.lastPageOffset_ ?
      this.totalPages_ - 1 :
      Math.floor(this.currentScroll_ / this.pageHeight_);
  this.prevPageOffset_ = this.currentPage_ * this.pageHeight_;
  this.nextPageOffset_ = Math.min(this.prevPageOffset_ + this.pageHeight_);
}

/**
 * @private
 */
ScrollRenderer.prototype.scrollBook = function(scrollLength) {
  var newOffset = this.iframeWindow_.scrollY + scrollLength;
  this.iframeWindow_.scrollTo(0, newOffset);
  return Promise.resolve();
}

/**
 * Navigate to page.
 * @param {number} pageNumber
 * @return {Promise}
 */
ScrollRenderer.prototype.navigatePage = function(page) {
  this.iframeWindow_.scrollTo(0, this.pageHeight_ * page);
  return Promise.resolve();
}

/**
 * Get total page count.
 * @return {number}
 */
ScrollRenderer.prototype.getPagesCount = function() {
  return this.totalPages_;
}

/**
 * Get current page.
 * @return {number}
 */
ScrollRenderer.prototype.getCurrentPage = function() {
  return this.currentPage_;
}

/**
 * Find element page.
 * @param {Element} element
 * @return {number}
 */
ScrollRenderer.prototype.getElementPage_ = function(element) {
  var elementOffset = this.iframeDocument_.body.scrollTop +
      Math.floor(element.getBoundingClientRect().top);
  return Math.floor(elementOffset / this.pageHeight_);
};

/**
 * Create ScrollRenderer.
 * @param {!Element} container
 * @return {ScrollRenderer}
 */
ScrollRenderer.create = function(container) {
  return Promise.resolve(new ScrollRenderer(container));
}

module.exports = ScrollRenderer;

},{"../../common/core":6,"../base/renderer":44,"./scroll_page_renderer.css":50}]},{},[14])(14)
});

//# sourceMappingURL=reader_core.js.map
