'use strict';

(function() {
  let whitelist = new Map([
    [self, new Set(['console', 'Object', 'Array', 'Function'])],
    [Map.prototype, new Set(['get'])],
    [Set.prototype, new Set(['add', 'has', 'delete'])],
    [console, new Set(['log'])],
    [Array, new Set(['isArray'])],
    [Array.prototype, new Set(["constructor"])],
    [Function.prototype, new Set(["length", "name", "arguments", "caller", "constructor"])],
    [Object, new Set(["assign", "getOwnPropertyDescriptor", "getOwnPropertyDescriptors", "getOwnPropertyNames", "getOwnPropertySymbols", "is", "preventExtensions", "seal", "create", "defineProperties", "defineProperty", "freeze", "getPrototypeOf", "setPrototypeOf", "isExtensible", "isFrozen", "isSealed", "keys", "entries", "values"])],
    [Object.prototype, new Set(["__proto__", "constructor"])],
  ]);
  let empty = new Set();
  let MyObject = Object;
  function protect(object) {
    if (MyObject.isFrozen(object)) {
      return;
    }
    let whitelisted = whitelist.get(object) || empty;
    let children = [];
    let descriptors = MyObject.getOwnPropertyDescriptors(object);
    for (let name in descriptors) {
      let descriptor = descriptors[name];
      if (!descriptor.configurable) {
        console.log('warning', name, 'not configurable');
      }
      try {
        children.push(object[name]);
      } catch (e) {}
      try {
        if (!whitelisted.has(name)) {
          delete object[name];
        }
      } catch (e) {}
    }
    MyObject.freeze(object);
    protect(object.constructor);
    for (let child of children) {
      protect(child);
    }
  }

  protect(self);
  console.log('done');
})();
