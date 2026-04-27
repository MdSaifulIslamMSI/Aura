'use strict';

if (typeof globalThis.DOMException === 'function') {
  module.exports = globalThis.DOMException;
} else {
  module.exports = class DOMException extends Error {
    constructor(message = '', name = 'Error') {
      super(message);
      this.name = name;
    }
  };
}
