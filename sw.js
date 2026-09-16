// ===== Service Worker：アプリのファイルを端末に保存し、オフラインでも開けるようにする =====
// ページとは別に動く小さなプログラム。ページが読み込むファイルを横取りして、保存しておいた分を返す。
// 保存するのはアプリのファイルだけ。記録（localStorage）には触れないので、更新しても記録は消えない。
//
// 公開の前に必ず `node tools/stamp-sw.mjs` を実行する。下の「更新印」（各ファイルの中身の SHA-256 と、
// そこから作る保存場所の名前 CACHE_NAME）が書き直されて sw.js の中身が変わり、ブラウザが新しい版を入れ直す。
// 新しい版は、次にアプリを開いたとき・戻ったときに反映される。
// ファイルを増やしたら tools/stamp-sw.mjs の APP_FILES に足す（tests/test-pwa.mjs が漏れを確かめる）

// ===== 更新印ここから（tools/stamp-sw.mjs が書き換える。手で直さない） =====
const CACHE_NAME = 'kimochi-diary-f2feb8ff3723';
const APP_FILES = {
  './': 'c9e16f11a24229b2f3292851fa7765dae035d079b56cde95182fccf53c3841b1',
  'index.html': 'c9e16f11a24229b2f3292851fa7765dae035d079b56cde95182fccf53c3841b1',
  'style.css': '542788771e1452a3a3413b54fed7095526f0fa8093afbc815e688c1e197878be',
  'manifest.webmanifest': '77207f237ebc14db658fc8d1882cf6c857148a5905f9f5a452eb291e9fe1f501',
  'js/common.js': '69e46dda97c63714ba09a111c98b3ae6ddeb49696a20c7f7846f51f432d61018',
  'js/storage.js': '9140651c63291a4f157889e990abb3dfd97ec50c249e76bc5dd12ee571d143b2',
  'js/toast.js': 'a402f0897b19bc023842ebe06a612ad51923cd71e02e4a1b185f64643af17fbf',
  'js/record.js': '206d1da92de98c3447ff7e2e2d9a76a01d05200c0ecc33840bc365fce1874816',
  'js/calendar.js': '3b035bb9800b9ba49093fab0e5b81cb1e284a2ea7b40853c5eb25c856eea6d3e',
  'js/graph.js': '363031cc4067976e810789d644784a7bb55e9b4d75a5385c53edfa42a0ffa70d',
  'js/settings.js': '3ebfcfcc2c90aed18fdb2591666b6876e0e640a502bb9d07aebc45e86437b60a',
  'js/main.js': '158c760e5f87a5da205bd04a2c9a5db68cc2160f0e4f8ff4f70c6b34324c3514',
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
