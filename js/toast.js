// ===== お知らせ（トースト）：記録・設定・起動時の知らせで共通に使う =====
const toastRegion = document.getElementById('toast');
let toastTimer;

function toastPart(tag, className, text) {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text; // textContent は文字をそのまま表示する（HTML として解釈されないので安全）
  return el;
}

// 画面の上にお知らせを出す。読み上げ用の枠（role="status"）は常に表示しておき、中身だけを入れ替える。
// 毎回新しい要素を作るので、弾むアニメーションも毎回最初から再生される
function showToast({ text, title = '', icon = '', duration = 2600 }) {
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

  toastRegion.replaceChildren(box);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastRegion.replaceChildren(), duration);
}
