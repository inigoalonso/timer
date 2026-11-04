'use strict';
const DISPLAY_CACHE = 'stage-time-display-v2';
const DISPLAY_SHELL = '/static/index.html';
const DISPLAY_ASSETS = [DISPLAY_SHELL, '/static/style.css', '/static/app.js',
  '/static/notifications.js', '/static/display-links.js', '/static/display-pwa.js',
  '/static/display.webmanifest', '/static/vendor/qrcode.js', '/static/vendor/NoSleep.min.js',
  '/static/vendor/lucide.min.js', '/static/vendor/jsQR.js',
  '/static/icons/display-192.png', '/static/icons/display-512.png',
  '/static/icons/display-maskable.png', '/static/icons/apple-touch-icon.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(DISPLAY_CACHE).then(cache => cache.addAll(DISPLAY_ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('stage-time-display-') && key !== DISPLAY_CACHE)
    .map(key => caches.delete(key)))));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate' && /^\/display\/(?:[A-Za-z0-9_-]+)?$/.test(url.pathname)) {
    event.respondWith(caches.open(DISPLAY_CACHE).then(async cache =>
      await cache.match(DISPLAY_SHELL) || fetch(event.request)));
  } else if (DISPLAY_ASSETS.includes(url.pathname) && !url.search) {
    event.respondWith(caches.open(DISPLAY_CACHE).then(async cache =>
      await cache.match(url.pathname) || fetch(event.request)));
  }
});