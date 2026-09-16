// ===== カレンダー画面 =====
const calendarEl = document.getElementById('calendar');
const calTitleEl = document.getElementById('cal-title');
const calSummaryEl = document.getElementById('cal-summary');
const calPrevBtn = document.getElementById('cal-prev');
const calNextBtn = document.getElementById('cal-next');
const calKindEl = document.getElementById('cal-kind');
const calLegendEl = document.getElementById('cal-legend');
const dayDetailEl = document.getElementById('day-detail');

// 表示中の年・月（月は 0〜11）と、選択中の日
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();
let selectedKey = toDateKey(new Date());

// マスに出すのは気分か体調か。選んだ方は storage.js で覚えておき、次に開いたときも同じにする
const CAL_KINDS = {
  mood: { field: 'mood', name: '気分', options: MOODS },
  condition: { field: 'condition', name: '体調', options: CONDITIONS },
};
let calKind = loadCalendarKind();

function renderCalendar() {
  const records = loadRecords();
  const kind = CAL_KINDS[calKind];
  const todayKey = toDateKey(new Date());
  const firstWeekday = new Date(calYear, calMonth, 1).getDay(); // 1日が何曜日か（0=日）
  const lastDate = new Date(calYear, calMonth + 1, 0).getDate(); // 「翌月の0日」＝今月の末日

  calTitleEl.textContent = `${calYear}年${calMonth + 1}月`;

  // 1日の曜日の位置まで空白マスで埋める
  let html = '<div class="cal-cell is-blank"></div>'.repeat(firstWeekday);
  const levels = [];

  for (let d = 1; d <= lastDate; d++) {
    const key = toDateKey(new Date(calYear, calMonth, d));
    const r = records[key];
    const level = r?.[kind.field]; // 気分か体調の段階（1〜5）
    const option = r && kind.options[level - 1];
    if (r) levels.push(level);

    const weekday = (firstWeekday + d - 1) % 7;
    const isToday = key === todayKey;
    const classes = ['cal-cell'];
    if (weekday === 0) classes.push('is-sun');
    if (weekday === 6) classes.push('is-sat');
    if (isToday) classes.push('is-today');
    if (key === selectedKey) classes.push('is-selected');

    // 段階は loadRecords() で 1〜5 の整数に直してあるので、そのまま属性に入れても安全。
    // 色は data-level で付ける（気分・体調で同じ5段階の色）。
    // 未来の日は押せなくする。選択中（aria-pressed）と今日（aria-current）は読み上げでも伝える
    html += `
      <button type="button" class="${classes.join(' ')}" data-date="${key}"
        ${r ? `data-level="${level}"` : ''} ${key > todayKey ? 'disabled' : ''}
        aria-pressed="${key === selectedKey}" ${isToday ? 'aria-current="date"' : ''}
        aria-label="${calMonth + 1}月${d}日${option ? `、${kind.name}：${option.label}` : ''}">
        <span class="cal-day">${d}</span>
        <span class="cal-icon">${option ? option.icon : ''}</span>
      </button>`;
  }
  calendarEl.innerHTML = html;

  const avg = average(levels);
  calSummaryEl.textContent = levels.length
    ? `記録 ${levels.length}日 ・ 平均の${kind.name} ${kind.options[Math.round(avg) - 1].icon} ${avg.toFixed(1)}`
    : 'この月の記録はまだありません';

  calNextBtn.disabled = isCurrentOrFutureMonth(calYear, calMonth); // 今月より先へは進めない
  calPrevBtn.disabled = calYear * 12 + calMonth <= MIN_YEAR * 12;  // 2000年1月より前へは戻れない
  renderCalendarKind();
}

// 「気分｜体調」の選択状態と、色の凡例（段階ごとの背景色）
function renderCalendarKind() {
  for (const btn of calKindEl.children) btn.setAttribute('aria-pressed', btn.dataset.kind === calKind);
  calLegendEl.innerHTML = CAL_KINDS[calKind].options
    .map((o) => `<span class="legend-item"><span class="legend-swatch" data-level="${o.value}">${o.icon}</span>${o.label}</span>`)
    .join('');
}

function isInShownMonth(key) {
  const d = fromDateKey(key);
  return d.getFullYear() === calYear && d.getMonth() === calMonth;
}

// 選択中の日の記録をカレンダーの下に表示する
function renderDayDetail() {
  // 月を送った直後は、その月の日を選ぶまで詳細を出さない
  if (!isInShownMonth(selectedKey)) {
    dayDetailEl.innerHTML = '<p class="detail-empty">日付を選ぶと、その日の記録が表示されます</p>';
    return;
  }

  const r = loadRecords()[selectedKey];
  const title = `<h2 class="detail-title">${formatDateJa(selectedKey)}</h2>`;

  if (!r) {
    dayDetailEl.innerHTML = `${title}
      <p class="detail-empty">この日の記録はまだありません</p>
      <button type="button" class="sub-btn" data-edit>この日を記録する</button>`;
    return;
  }

  const mood = MOODS[r.mood - 1];
  const cond = CONDITIONS[r.condition - 1];
  // 空の項目は「—」で出す（無いのか、隠れているのか分からなくならないように）。
  // 「—」は読み上げで読まれない・読み方が端末で違うことがあるので、読み上げには「なし」と伝える
  const none = '<span aria-hidden="true">—</span><span class="sr-only">なし</span>';
  const sleeps = recordSleeps(r);
  const sleepHtml = sleeps.length
    ? escapeHtml(`${formatHours(totalSleepHours(r))}（${sleeps.map((s) => `${s.start}〜${s.end}`).join('、')}）`)
    : none;

  // メモ・頑張ったことは利用者が入力した文字なので escapeHtml を通してから入れる
  dayDetailEl.innerHTML = `${title}
    <div class="detail-chips">
      <span class="chip" data-mood="${r.mood}">${mood.icon} 気分：${mood.label}</span>
      <span class="chip">${cond.icon} 体調：${cond.label}</span>
    </div>
    <dl class="detail-list">
      <dt>睡眠</dt><dd>${sleepHtml}</dd>
      <dt>メモ</dt><dd>${r.memo ? escapeHtml(r.memo) : none}</dd>
      <dt>頑張ったこと</dt><dd>${r.effort ? escapeHtml(r.effort) : none}</dd>
    </dl>
    <button type="button" class="sub-btn" data-edit>この日を編集する</button>`;
}

function renderCalendarView() {
  renderCalendar();
  renderDayDetail();
}

function moveMonth(delta) {
  const next = shiftMonth(calYear, calMonth, delta);
  calYear = next.year;
  calMonth = next.month;
  renderCalendarView();
  // 端に着いてボタンが押せなくなると、フォーカスの行き場がなくなるので反対側へ移す
  if (delta > 0 && calNextBtn.disabled) calPrevBtn.focus();
  if (delta < 0 && calPrevBtn.disabled) calNextBtn.focus();
}

// 日付が変わったとき（main.js から呼ぶ）：今月・今日を表示し直す
function calendarToToday() {
  const now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth();
  selectedKey = toDateKey(now);
}

calPrevBtn.addEventListener('click', () => moveMonth(-1));
calNextBtn.addEventListener('click', () => moveMonth(1));

calKindEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-kind]');
  if (!btn || btn.dataset.kind === calKind) return;
  calKind = btn.dataset.kind;
  saveCalendarKind(calKind);
  renderCalendar();
});

// マスは描き直すたびに作り直すので、リスナーは親の calendarEl に1つだけ付ける（イベント委譲）
calendarEl.addEventListener('click', (e) => {
  const cell = e.target.closest('[data-date]');
  if (!cell || cell.disabled) return;
  selectedKey = cell.dataset.date;
  renderCalendarView();
  // 描き直すと押したボタンは作り直されて、フォーカスが外れる。同じ日のボタンへ戻す
  calendarEl.querySelector(`[data-date="${selectedKey}"]`).focus({ preventScroll: true });
  revealDayDetail();
});

// 選んだ日の詳細が下のタブバーに隠れていたら、見える所までスクロールする（カレンダーの下にあるので、
// スマホでは詳細の下の方〔頑張ったこと など〕が隠れやすい）。詳細が画面より高いときは、上端が見える所で止める
function revealDayDetail() {
  const box = dayDetailEl.getBoundingClientRect();
  const visibleBottom = document.getElementById('tabs').getBoundingClientRect().top - 16;
  const by = Math.min(box.bottom - visibleBottom, box.top - 16);
  if (by <= 0) return;
  const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollBy({ top: by, behavior: smooth ? 'smooth' : 'auto' });
}

dayDetailEl.addEventListener('click', (e) => {
  if (!e.target.closest('[data-edit]')) return;
  if (!openRecord(selectedKey)) return; // 書きかけを捨てないと決めたら移動しない
  showView('record');
  focusRecordView(); // 押したボタンは隠れた画面にあるので、フォーカスを記録画面へ移す
});

renderCalendarKind();
