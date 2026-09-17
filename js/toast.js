// ===== お知らせ（トースト）：記録・設定・起動時の知らせで共通に使う =====
const toastRegion = document.getElementById('toast');
let toastTimer;

function toastPart(tag, className, text) {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text; // textContent は文字をそのまま表示する（HTML として解釈されないので安全）
  return el;
}

function hideToast() {
  clearTimeout(toastTimer);
  toastRegion.replaceChildren();
}

// お知らせは、画面の下の操作のすぐ上に出す（保存した後に、視線を画面の上へ戻さなくてよいように）。
// 表示中の画面に data-toast-anchor（記録画面の保存ボタンの帯）があればそのすぐ上、無ければ下のタブのすぐ上。
// キーボードなどで見えている範囲が狭いときは、見えている範囲の下端の上に出す。
// 位置は枠の下端を CSS の --toast-bottom（画面の上からの距離）に置く
function positionToast() {
  if (!toastRegion.firstChild) return;
  let bottom = document.getElementById('tabs')?.getBoundingClientRect().top ?? window.innerHeight;
  const anchor = [...document.querySelectorAll('[data-toast-anchor]')].find((el) => el.getClientRects().length);
  const anchorTop = anchor?.getBoundingClientRect().top;
  // 帯がスクロールで画面の上の方へ行っているときは使わない（お知らせが画面の外や上端に出ないように）
  if (anchorTop >= 80) bottom = Math.min(bottom, anchorTop);
  if (window.visualViewport) bottom = Math.min(bottom, visualViewport.offsetTop + visualViewport.height);
  toastRegion.style.setProperty('--toast-bottom', `${Math.round(bottom)}px`);
}
for (const target of [window, window.visualViewport]) {
  target?.addEventListener('scroll', positionToast, { passive: true });
  target?.addEventListener('resize', positionToast);
}
// 帯の高さが変わったとき（お知らせを出している間に、エラーの文が帯に出た など）も置き直す。重なってエラーの文を隠さないように
if (window.ResizeObserver) {
  const anchorObserver = new ResizeObserver(positionToast);
  for (const el of document.querySelectorAll('[data-toast-anchor]')) anchorObserver.observe(el);
}

// 画面の下にお知らせを出す。読み上げ用の枠（role="status"）は常に表示しておき、中身だけを入れ替える。
// 毎回新しい要素を作るので、弾むアニメーションも毎回最初から再生される。
// action（{ label, onClick }）を渡すと、「元に戻す」のようなボタンを添える（押すとお知らせは閉じる）
function showToast({ text, title = '', icon = '', duration = 2600, action = null }) {
  const box = document.createElement('div');
  box.className = 'toast';
  if (icon) {
    const iconEl = toastPart('span', 'toast-icon', icon);
    iconEl.setAttribute('aria-hidden', 'true'); // 絵文字の名前は読み上げない
    box.append(iconEl);
  }
  const body = document.createElement('div');
  if (title) body.append(toastPart('div', 'toast-title', title));
  body.append(toastPart('div', 'toast-text', text));
  box.append(body);
  if (action) {
    const btn = toastPart('button', 'toast-action', action.label);
    btn.type = 'button';
    btn.addEventListener('click', () => {
      hideToast();
      action.onClick();
    });
    box.append(btn);
  }

  toastRegion.replaceChildren(box);
  positionToast();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, duration);
}
