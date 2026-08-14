const CACHE_NAME = "campusnotify-v3";

const FILES_TO_CACHE = [
    "./",
    "./index.html",
    "./style.css",
    "./script.js",
    "./manifest.json",
    "./icons/campusnotify-icon-512.png",
    "./icons/icon-512.png",
    "./icons/icon-192.png"
];

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(FILES_TO_CACHE))
    );
    self.skipWaiting();
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            )
        )
    );
    self.clients.claim();
});

self.addEventListener("fetch", event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => response || fetch(event.request))
    );
});

/* ================================================= */
/* PUSH NOTIFICATIONS                                */
/* ================================================= */

self.addEventListener("push", event => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch (e) {
        data = { title: "CampusNotify", body: event.data ? event.data.text() : "New notice published" };
    }

    const title = data.title || "New Notice";
    const options = {
        body: data.body || "A new notice has been published.",
        icon: "./icons/icon-192.png",
        badge: "./icons/icon-192.png",
        data: {
            url: data.url || "./index.html"
        },
        vibrate: [100, 50, 100]
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
    event.notification.close();

    const targetUrl = (event.notification.data && event.notification.data.url) || "./index.html";

    event.waitUntil(
        clients.matchAll({ type: "window", includeUncontrolled: true }).then(clientList => {
            for (const client of clientList) {
                if (client.url.includes(targetUrl) && "focus" in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});
