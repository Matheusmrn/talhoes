// Service worker: deixa o app abrir rápido e funcionar sem internet
// (as imagens de satélite e o clima continuam precisando de internet).
const VERSAO = "talhoes-v3";
const ARQUIVOS = [
  "./", "./index.html", "./manifest.webmanifest",
  "./js/dados.js", "./js/relatorio.js", "./js/campo.js",
  "./lib/leaflet/leaflet.js", "./lib/leaflet/leaflet.css",
  "./lib/leaflet/images/layers.png", "./lib/leaflet/images/layers-2x.png",
  "./lib/leaflet/images/marker-icon.png", "./lib/leaflet/images/marker-icon-2x.png", "./lib/leaflet/images/marker-shadow.png",
  "./lib/leaflet-draw/leaflet.draw.js", "./lib/leaflet-draw/leaflet.draw.css",
  "./lib/leaflet-draw/images/spritesheet.png", "./lib/leaflet-draw/images/spritesheet-2x.png", "./lib/leaflet-draw/images/spritesheet.svg",
  "./lib/jspdf/jspdf.umd.min.js",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-180.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // satélite, clima e mapas: sempre da internet
  // arquivos do app: tenta a rede (versão mais nova) e cai no cache se estiver sem internet
  e.respondWith(
    fetch(e.request).then(r => { if (r.ok){ const c = r.clone(); caches.open(VERSAO).then(ca => ca.put(e.request, c)); } return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match("./index.html")))
  );
});
