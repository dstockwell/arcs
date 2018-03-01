((initURL) => {
  function assert(condition) {
    if (!condition)
      throw new Error();
  }
  let tasks = [];
  let registry = {};
  let globalURL = null;
  let depth = 0;
  function define(dependencies, factory) {
    let url = globalURL;
    assert(url != null);
    assert(!registry[url]);
    globalURL = null;

    depth++;
    let exports = registry[url] = {__esModule: true};
    let args = dependencies.map(dep => dep == 'exports' ? exports : load(url, dep));
    tasks.push(() => factory(...args));
    if (depth == 1) {
      console.time('tasks');
      while (tasks.length) {
        tasks.shift()();
      }
      console.timeEnd('tasks');
    }
    depth--;
  }
  function load(from, request) {
    request = new URL(request + '?transpile', from).href;
    if (!registry[request]) {
      globalURL = request;
      importScripts(request);
      globalURL = null;
    }
    return registry[request];
  }
  self.define = define;
  console.time('load');
  load(location + '', initURL);
  console.timeEnd('load');
})('/runtime/browser/worker-entry.js');