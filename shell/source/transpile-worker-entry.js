
importScripts('https://unpkg.com/@babel/standalone@7.0.0-beta.40/babel.min.js');

let importModule = url => {
  function assert(condition) {
    if (!condition)
      throw new Error();
  }

  function transpile(url, code) {
    let result = Babel.transform(code, {
      sourceType: 'module',
      filename: url,
      plugins: ['transform-modules-amd'],
      sourceMaps: 'inline',
    });
    return 'data:text/javascript;base64,' + btoa(result.code);
  }

  let defineArgs = null;
  function define(dependencies, factory) {
    defineArgs = {dependencies, factory};
  }

  let fetchCache = {};
  function fetchAndDefine(url) {
    if (!fetchCache[url]) {
      fetchCache[url] = (async () => {
        let result = await fetch(url);
        let code = await result.text();
        let transpiled = transpile(url, code);
        defineArgs = null;
        importScripts(transpiled);
        let {dependencies, factory} = defineArgs;
        defineArgs = null;
        // Prefetch and cache dependency chain.
        for (let dep of dependencies) {
          if (dep != 'exports') {
            fetchAndDefine(new URL(dep, url).href);
          }
        }
        return {dependencies, factory};
      })();
    }
    return fetchCache[url];
  }

  let registry = {};
  async function load(from, request) {
    request = new URL(request, from).href;
    if (registry[request]) {
      return registry[request];
    }
    let exports = registry[request] = {__esModule: true};
    let {dependencies, factory} = await fetchAndDefine(request);
    let args = [];
    for (let dep of dependencies) {
      if (dep == 'exports') {
        args.push(exports);
      } else {
        args.push(await load(request, dep));
      }
    }
    factory(...args);
    return exports;
  }
  self.define = define;

  return load(location + '', url);
};

// Since the worker is loaded asynchronously we must hold this message
// until it's ready.
let message;
self.onmessage = function(e) {
  message = e;
  self.onmessage = null;
};

console.time('loading worker-entry.js');
importModule('worker-entry.js').then(() => {
  console.timeEnd('loading worker-entry.js');
  self.onmessage(message);
});