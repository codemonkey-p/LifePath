const CACHE_NAME = 'lifepath-shell-v2';
const SHELL_FILES = [
  '/', '/index.html', '/home.html', '/wizard.html', '/brainExercises.html',
  '/quiz.html', '/games.html', '/matchGame.html', '/missingGame.html', '/seenGame.html',
  '/whereGame.html', '/colorGame.html', '/profile.html',
  '/css/style.css', '/js/app.js', '/js/game-kit.js', '/js/voice-client.js', '/js/realtime-voice-client.js',
  '/manifest.json', '/icons/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || event.request.url.includes('/api/')) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
