importScripts('https://unpkg.com/@babel/standalone@7.0.0-beta.40/babel.min.js');

addEventListener('fetch', event => {
  if (/\?transpile$/.test(event.request.url)) {
    event.respondWith((async () => {
      let code = await (await fetch(event.request)).text();
      let result = Babel.transform(code, {sourceType: 'module', plugins: ['transform-modules-amd']}).code;
      let response = new Response(result);
      return response;
    })());
  }
});

addEventListener('activate', () => {
  clients.claim();
  console.log('hello world');
});


