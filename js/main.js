// ===== 画面の切り替え（下のタブ）と起動 =====
const tabsEl = document.getElementById('tabs');
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

// ホーム画面版の iPhone アプリは、閉じても裏で開いたまま残りやすい。
// 戻ってきたときに日付が変わっていないか確かめ、表示中の画面を最新にする
function onResume() {
  if (refreshToday()) calendarToToday();
  if (currentView !== 'record') showView(currentView, { scrollTop: false });
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') onResume();
});
// 「戻る」などでページがキャッシュから復元されたとき
window.addEventListener('pageshow', (e) => {
  if (e.persisted) onResume();
});

showView('record');

// 保存データに問題があったときは、起動時に長めに知らせる
if (storageNotice) showToast({ icon: '⚠️', text: storageNotice, duration: 6000 });

// PWA：Service Worker（sw.js）を登録して、オフラインでも開けるようにする。
// file:// で開いたときや、登録できない環境（プレビューなど）では何もしない
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ホーム画面版では、保存データを消されにくくするよう申請する（認めるかはブラウザが決める）。
// Safari 版で申請すると確認を出すブラウザもあるので、ホーム画面版のときだけにする
if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) {
  navigator.storage?.persist?.().catch(() => {});
}
