// ===== Service Worker：アプリのファイルを端末に保存し、オフラインでも開けるようにする =====
// ページとは別に動く小さなプログラム。ページが読み込むファイルを横取りして、保存しておいた分を返す。
// 保存するのはアプリのファイルだけ。記録（localStorage）には触れないので、更新しても記録は消えない。
//
// 公開の前に必ず `node tools/stamp-sw.mjs` を実行する。下の「更新印」（各ファイルの中身の SHA-256 と、
// そこから作る保存場所の名前 CACHE_NAME）が書き直されて sw.js の中身が変わり、ブラウザが新しい版を入れ直す。
// 新しい版は、次にアプリを開いたとき・戻ったときに反映される。
// ファイルを増やしたら tools/stamp-sw.mjs の APP_FILES に足す（tests/test-pwa.mjs が漏れを確かめる）

// ===== 更新印ここから（tools/stamp-sw.mjs が書き換える。手で直さない） =====
const CACHE_NAME = 'kimochi-diary-a6c776357aae';
const APP_FILES = {
  './': '58173d26278860a2befed14d3254b5afb78a57399c7a3d0458495b66b7e48db0',
  'index.html': '58173d26278860a2befed14d3254b5afb78a57399c7a3d0458495b66b7e48db0',
  'style.css': '220afe8c63919eff191d7d97dfed2b0c2fb40f06cf7236789f2c90ba648e90ad',
  'manifest.webmanifest': '77207f237ebc14db658fc8d1882cf6c857148a5905f9f5a452eb291e9fe1f501',
  'js/common.js': '82a9ba149c3650fc436e08cac604ab7199a2a91a6a639b8f1bfee5ba7012a351',
  'js/storage.js': '61fd2d454fbbe5130109fed0d8e0d24339d38c20511cbff333253d348c075f0f',
  'js/toast.js': '9633cea38db399b70f910c9d131a1b2f0981e2ee79c8733b98c1bc70993dc3b8',
  'js/record.js': '11282e4ed79f3e507604b5519dabbcc3b3e5d14fc355bc864bc8df920ec8d38e',
  'js/calendar.js': 'e44f6d07d0bc6ebdfa4f98bce402dc0a505b91886c66fc7098cc41601c46bfa5',
  'js/graph.js': '2f17139eaae2044a450d46a06454a82f35d802f4b26bf2d69b5cd178e399b4be',
  'js/settings.js': '8e4c36774a219a04dc96e1b159717ed9a9dda2d0735da06aeea8282dbd3f480e',
  'js/main.js': 'ec314f45a1d4203f80d051d8d2b565981b315676fa1f320098de05469d83d2fd',
  'images/botanical-shadow.webp': 'aa4c3b29a2f512707192756ebffab2f428e94baf95ce7bd385b73ac715ab5d51',
  'icons/icon.svg': '2be433dd9f88ebde51bcfbe6036e2191f496c1b9015fe5a76b9785c8336518d1',
  'icons/icon-192.png': '30c2e78570d71409f654b9a2bbfb36dec0365f4049325f99dd9e2d804a801b01',
  'icons/icon-512.png': '7400687fb44f1cffc85699cc6bd2e81c320188ba57a8b205f2a7e3cd43f44f59',
  'icons/apple-touch-icon.png': '965be40bca02c71bf40d17010804ca6743468e1a90ef36ff2e25e980f2d3322e',
};
// ===== 更新印ここまで =====

// 中身の SHA-256（16進の文字列）
async function sha256(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 入れたとき：ファイルを取り、中身が更新印と合うか確かめてから保存する。
// - GitHub Pages の配信元（CDN）は、公開の直後しばらく古い写しを返すことがある。URL に ?v= を付けても
//   配信元はそこを見ないので、中身を照らし合わせて確かめる。1つでも違う・取れなければ更新を取りやめ、
//   前の版のまま使う（次に新しい版を確かめたときに、やり直す）
// - cache: 'reload' で、ブラウザの一時保存は使わない
// - この版の保存にもう入っているファイル（前にやり直したときに取れた分）は取り直さない
// - 失敗しても保存は消さない（使っている版の保存を消さないため。残った分は次のやり直しで使い、
//   不要になれば新しい版に切り替わったときに消える）
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // 1つ失敗しても残りは取り終えてから止める（次にやり直すとき、取れなかった分だけ取ればよいように）
    const results = await Promise.allSettled(Object.entries(APP_FILES).map(async ([url, hash]) => {
      if (await cache.match(url)) return;
      const response = await fetch(url, { cache: 'reload' });
      if (!response.ok) throw new Error(`${url}: ${response.status}`);
      if (await sha256(await response.clone().arrayBuffer()) !== hash) throw new Error(`${url}: 中身が更新印と違う`);
      await cache.put(url, response);
    }));
    const failed = results.find((r) => r.status === 'rejected');
    if (failed) throw failed.reason;
    await self.skipWaiting(); // 古い版の終了を待たずに、すぐ切り替える
  })());
});

// 切り替わったとき：古い版の保存を消す。github.io は同じユーザーの別のサイトと保存場所を共有するので、
// このアプリの名前（kimochi-diary-）で始まるものだけを消す
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith('kimochi-diary-') && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

// ファイルの読み込み：この版の保存にあればそれを返し、無ければネットから取る（保存を優先）。
// 探すのはこのアプリの保存（CACHE_NAME）だけ。caches.match() は同じ場所のすべての保存を探すので、
// 別のサイトが同じ名前のファイルを保存していると、その中身を返してしまう
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(request, { ignoreSearch: true })
      ?? (request.mode === 'navigate' ? await cache.match('./') : undefined);
    return hit ?? fetch(request);
  })());
});
