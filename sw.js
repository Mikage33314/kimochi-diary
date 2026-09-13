// ===== Service Worker：アプリのファイルを端末に保存し、オフラインでも開けるようにする =====
// ページとは別に動く小さなプログラム。ページが読み込むファイルを横取りして、保存しておいた分を返す。
//
// 更新を配るときは CACHE_NAME の版を上げる（v1 → v2）。sw.js の中身が変わると、ブラウザが新しい
// Service Worker を入れ直し、ファイルを取り直す。新しい版は、次にアプリを開いたときに反映される。
// ファイルを増やしたら APP_FILES にも足す（tests/test-pwa.mjs が漏れを確かめる）
const CACHE_NAME = 'kimochi-diary-v1';
const APP_FILES = [
  './',
  'index.html',
  'style.css',
  'manifest.webmanifest',
  'js/common.js',
  'js/toast.js',
  'js/record.js',
  'js/calendar.js',
  'js/graph.js',
  'js/settings.js',
  'js/main.js',
  'images/botanical-shadow.webp',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

// 入れたとき：全ファイルを保存する。cache: 'reload' で、ブラウザの一時保存（古いかもしれない）を使わずに取り直す
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_FILES.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()), // 古い版の終了を待たずに、すぐ切り替える
  );
});

// 切り替わったとき：古い版の保存を消す。github.io は同じユーザーの別のサイトと保存場所を共有するので、
// このアプリの名前（kimochi-diary-）で始まるものだけを消す
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith('kimochi-diary-') && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// ファイルの読み込み：保存してあればそれを返し、無ければネットから取る（保存を優先）
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(request, { ignoreSearch: true })
      .then((hit) => hit || (request.mode === 'navigate' ? caches.match('./') : undefined))
      .then((hit) => hit || fetch(request)),
  );
});
