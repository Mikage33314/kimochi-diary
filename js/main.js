// ===== 画面の切り替え（下のタブ）・アプリに戻ったとき・更新（Service Worker）・ホーム画面版の案内・起動 =====
const tabsEl = document.getElementById('tabs');
const installGuideEl = document.getElementById('install-guide');
const guideCloseBtn = document.getElementById('guide-close');
let currentView = 'record';

// 表示するたびに最新のデータで描き直す（記録画面で保存・削除した内容がすぐ反映される）
const VIEW_RENDERERS = {
  calendar: renderCalendarView,
  graph: renderGraph,
  settings: renderSettings,
};

function showView(name, { scrollTop = true } = {}) {
  currentView = name;
  for (const view of document.querySelectorAll('.view')) {
    view.hidden = view.dataset.view !== name;
  }
  for (const tab of tabsEl.querySelectorAll('.tab')) {
    const active = tab.dataset.view === name;
    tab.classList.toggle('is-active', active);
    if (active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  VIEW_RENDERERS[name]?.();
  if (scrollTop) window.scrollTo(0, 0);
}

tabsEl.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (tab) showView(tab.dataset.view);
});

// ----- 更新（Service Worker：sw.js） -----
// オフラインでも開けるようにする。新しい版が配られると sw.js が裏で入れ替わるが、開いている画面は
// 古い版のまま動き続ける。古い版を使い続けないよう、入力中でないときに読み込み直して反映する。
// （記録は localStorage にあり、読み込み直しても消えない。書きかけも退避してある）
let swRegistration = null;
let swUpdateReady = false; // 新しい版に切り替わったが、画面はまだ古い版のまま

function reloadIfUpdated() {
  if (!swUpdateReady || formDirty) return false; // 入力の途中で画面が変わらないよう、入力中は待つ
  location.reload();
  return true;
}

// file:// で開いたときや、登録できない環境（プレビューなど）では何もしない
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  // 初めて開いたときは、入れた Service Worker がページを受け持つ合図（controllerchange）が1回来る。
  // これは「更新」ではないので数えない。その後の入れ替わりは、同じ画面を開いたままでも更新として数える
  let hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) {
      hadController = true;
      return;
    }
    swUpdateReady = true;
    if (document.visibilityState === 'hidden') reloadIfUpdated(); // 裏にいる間なら、すぐ入れ替えてよい
  });
  navigator.serviceWorker.register('sw.js').then((reg) => { swRegistration = reg; }).catch(() => {});
}

// ----- ホーム画面版でないときの案内 -----
// ホーム画面から開いたか（iPhone の Safari は navigator.standalone、ほかは display-mode で分かる）
function isStandalone() {
  return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

// どの案内を出すか：'safari'（ホーム画面に追加してね）／'in-app'（Safari で開いてね）／null（出さない）。
// 対象は iPhone・iPad だけ。iPad の Safari は Mac と同じ名乗り（Macintosh）なので、タッチできるかで見分ける。
// LINE などアプリの中のブラウザは、ホーム画面に追加できず、記録も消えやすい
function installGuideKind(ua, standalone, touchPoints) {
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
  if (standalone || !isIOS) return null;
  return /\bLine\/|FBAN|FBAV|Instagram|MicroMessenger|Twitter|TikTok/i.test(ua) ? 'in-app' : 'safari';
}

let guideClosed = false; // 閉じたら、その起動の間は出さない（次に開いたときはまた出す）

function showInstallGuide() {
  const kind = guideClosed ? null : installGuideKind(navigator.userAgent, isStandalone(), navigator.maxTouchPoints);
  installGuideEl.hidden = !kind;
  for (const el of installGuideEl.querySelectorAll('[data-guide]')) el.hidden = el.dataset.guide !== kind;
}

guideCloseBtn.addEventListener('click', () => {
  guideClosed = true;
  showInstallGuide();
  focusRecordView(); // 押したボタンが消えるので、フォーカスを記録画面へ移す
});

// ----- アプリに戻ったとき -----
// ホーム画面版の iPhone アプリは、閉じても裏で開いたまま残りやすい。
// 戻ってきたときに、更新・日付の変化を確かめ、表示中の画面を最新にする
function onResume() {
  if (reloadIfUpdated()) return;
  swRegistration?.update().catch(() => {}); // 新しい版が出ていないか確かめる（オフラインなら何もしない）
  if (refreshToday()) {
    // 日付が変わっていたら、カレンダーとグラフも今日を含む月・期間に戻す
    calendarToToday();
    graphToToday();
  }
  if (currentView !== 'record') showView(currentView, { scrollTop: false });
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') onResume();
});
// 「戻る」などでページがキャッシュから復元されたとき
window.addEventListener('pageshow', (e) => {
  if (e.persisted) onResume();
});

// ----- 起動 -----
showView('record');
showInstallGuide();

// 保存データに問題があったときは、起動時に長めに知らせる
if (storageNotice) showToast({ icon: '⚠️', text: storageNotice, duration: 6000 });

// ホーム画面版では、保存データを消されにくくするよう申請する（認めるかはブラウザが決める）。
// Safari 版で申請すると確認を出すブラウザもあるので、ホーム画面版のときだけにする
if (isStandalone()) {
  navigator.storage?.persist?.().catch(() => {});
}
