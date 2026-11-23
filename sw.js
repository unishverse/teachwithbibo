/* Teach with Bibo service worker. Scope: /teachwithbibo/ only. Cache prefix: twb- */
var VERSION = "twb-v1";
var SHELL = VERSION + "-shell";
var MEDIA = "twb-media-v1"; // img/audio: file names never change content (blob ids), so keep across versions
var FONTS = "twb-fonts-v1";
var SHELL_FILES = [
  "./", "index.html", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png",
  "icons/apple-touch-icon.png", "icons/favicon-32.png", "audio/click.mp3"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) {
    return c.addAll(SHELL_FILES.map(function (u) { return new Request(u, { cache: "no-cache" }); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  var keep = [SHELL, MEDIA, FONTS];
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) {
      return k.indexOf("twb-") === 0 && keep.indexOf(k) < 0;
    }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function networkFirst(req) {
  return fetch(req, { cache: "no-cache" }).then(function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(SHELL).then(function (c) { c.put(req, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true }).then(function (hit) {
      return hit || (req.mode === "navigate" ? caches.match("index.html") : undefined) || Response.error();
    });
  });
}

function cacheFirst(req, name) {
  return caches.open(name).then(function (c) {
    return c.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && (res.ok || res.type === "opaque")) c.put(req, res.clone());
        return res;
      });
    });
  });
}

// <audio> asks for byte ranges; serve them from the full cached file so voice clips work offline.
function rangeFromCache(req) {
  var full = new Request(req.url);
  return cacheFirst(full, MEDIA).then(function (res) {
    if (!res || !res.ok) return res;
    return res.arrayBuffer().then(function (buf) {
      var m = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") || "");
      var size = buf.byteLength;
      var start = m && m[1] ? Number(m[1]) : 0;
      var end = m && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      if (m && !m[1] && m[2]) { start = Math.max(0, size - Number(m[2])); end = size - 1; }
      if (start >= size) return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + size } });
      return new Response(buf.slice(start, end + 1), {
        status: 206,
        headers: {
          "Content-Type": res.headers.get("Content-Type") || "audio/mpeg",
          "Content-Range": "bytes " + start + "-" + end + "/" + size,
          "Content-Length": String(end - start + 1),
          "Accept-Ranges": "bytes"
        }
      });
    });
  });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com") {
    e.respondWith(cacheFirst(req, FONTS)); return;
  }
  if (url.origin !== self.location.origin) return;
  var scope = new URL(self.registration.scope).pathname;
  if (url.pathname.indexOf(scope) !== 0) return; // never touch other Unishverse apps
  var rel = url.pathname.slice(scope.length);
  if (rel.indexOf("img/") === 0 || rel.indexOf("audio/") === 0) {
    if (req.headers.has("range")) { e.respondWith(rangeFromCache(req)); return; }
    e.respondWith(cacheFirst(req, MEDIA)); return;
  }
  e.respondWith(networkFirst(req));
});
