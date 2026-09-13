// ===== 記録画面：入力フォーム =====
const recordForm = document.getElementById('record-form');
const dateInput = document.getElementById('date');
const dateHintEl = document.getElementById('date-hint');
const memoInput = document.getElementById('memo');
const effortInput = document.getElementById('effort');
const recordStatusEl = document.getElementById('status'); // エラーなど、読み上げで知らせる一言
const editStateEl = document.getElementById('edit-state'); // 「○日の記録を編集中」（読み上げない）
const recordViewEl = document.querySelector('[data-view="record"]');
const saveBarEl = recordForm.querySelector('.save-bar');
const deleteBtn = document.getElementById('delete-btn');
const sleepList = document.getElementById('sleep-list');
const sleepTotalEl = document.getElementById('sleep-total');
const sleepTemplate = document.getElementById('sleep-row-template');
const addSleepBtn = document.getElementById('add-sleep');
const sameSleepBtn = document.getElementById('same-sleep');
const nudgeBtn = document.getElementById('yesterday-nudge');

let currentKey = '';                        // フォームに表示中の日付
let shownDefaultKey = '';                   // 「記録する日」の初期値として最後に使った日付
let lastSeenToday = toDateKey(new Date());  // 日付が変わったかの判定用
let formDirty = false;                      // 保存していない入力があるか
let prevSleeps = null;                      // 「前回と同じ」で入れる睡眠

// 定義配列から5段階のラジオボタンを作る
function buildScale(container, name, options) {
  for (const opt of options) {
    const label = document.createElement('label');
    label.className = 'scale-option';
    label.innerHTML = `
      <input type="radio" name="${name}" value="${opt.value}">
      <span class="scale-icon">${opt.icon}</span>
      <span class="scale-label">${opt.label}</span>`;
    container.appendChild(label);
  }
}

function setRadio(name, value) {
  for (const el of recordForm.elements[name]) {
    el.checked = Number(el.value) === value;
  }
}

// ----- 睡眠リスト -----
function readSleepRow(row) {
  return {
    start: row.querySelector('.sleep-start').value,
    end: row.querySelector('.sleep-end').value,
  };
}

// <template> の中身を複製して1行追加する
function addSleepRow(sleep = { start: '', end: '' }) {
  const row = sleepTemplate.content.firstElementChild.cloneNode(true);
  row.querySelector('.sleep-start').value = sleep.start;
  row.querySelector('.sleep-end').value = sleep.end;
  sleepList.appendChild(row);
}

// 各行の睡眠時間と合計を表示し直す。＋ボタンは上限に達したら隠す
function updateSleepList() {
  let total = 0;
  [...sleepList.children].forEach((row, i) => {
    const s = readSleepRow(row);
    const hours = isValidSleep(s) ? sleepHours(s) : 0;
    row.querySelector('.sleep-hours').textContent = hours ? formatHours(hours) : '';
    // 読み上げで行を区別できるよう、何件目かをラベルに入れる
    row.querySelector('.sleep-start').setAttribute('aria-label', `寝た時刻（${i + 1}件目）`);
    row.querySelector('.sleep-end').setAttribute('aria-label', `起きた時刻（${i + 1}件目）`);
    row.querySelector('.remove-sleep-btn').setAttribute('aria-label', `この睡眠を取り消す（${i + 1}件目）`);
    total += hours;
  });
  sleepTotalEl.textContent = total ? `合計 ${formatHours(total)}` : '';
  addSleepBtn.hidden = sleepList.children.length >= MAX_SLEEPS;
}

// 表示中の日より前で、睡眠を記録した一番新しい日（無ければ null）。
// "YYYY-MM-DD" は文字列のまま大小を比べられる
function findPrevSleepKey(dateKey) {
  const records = loadRecords();
  return Object.keys(records)
    .filter((k) => k < dateKey && records[k].sleeps.length > 0)
    .sort()
    .pop() ?? null;
}

// 「前回（9/12）と同じ 23:00〜07:00」。どの日の時刻かを日付で示す
function updateSameSleepBtn() {
  const key = findPrevSleepKey(currentKey);
  prevSleeps = key ? loadRecords()[key].sleeps : null;
  sameSleepBtn.hidden = !prevSleeps;
  if (!prevSleeps) return;
  const d = fromDateKey(key);
  const detail = prevSleeps.length === 1 ? ` ${prevSleeps[0].start}〜${prevSleeps[0].end}` : `（${prevSleeps.length}件）`;
  // 狭い画面で折り返すときは「前回（9/12）と同じ」と時刻の間で切れるよう、それぞれをひとかたまりにする
  const part = (text) => Object.assign(document.createElement('span'), { className: 'nowrap', textContent: text });
  sameSleepBtn.replaceChildren(part(`前回（${d.getMonth() + 1}/${d.getDate()}）と同じ`), part(detail));
}

// 行ごとにリスナーを付けず、リスト全体で受ける（イベント委譲）。後から増えた行にも効く
sleepList.addEventListener('input', updateSleepList);
sleepList.addEventListener('change', updateSleepList);
sleepList.addEventListener('click', (e) => {
  const removeBtn = e.target.closest('.remove-sleep-btn');
  if (!removeBtn) return;
  const row = removeBtn.closest('.sleep-row');
  const s = readSleepRow(row);
  row.remove();
  updateSleepList();
  // 空の行を足して取り消しただけなら、入力は変わっていない
  if (s.start || s.end || formDirty) markDirty();
  addSleepBtn.focus(); // 押したボタンが消えるので、フォーカスを「＋」へ移す
});

addSleepBtn.addEventListener('click', () => {
  if (sleepList.children.length >= MAX_SLEEPS) return;
  addSleepRow();
  updateSleepList();
});

sameSleepBtn.addEventListener('click', () => {
  sleepList.replaceChildren();
  for (const s of prevSleeps) addSleepRow(s);
  updateSleepList();
  markDirty();
});

// ----- 日付 -----
// 日付欄の横の「今日の記録／昨日の記録」と、「昨日の分もつける？」を更新する
function updateDateInfo() {
  const today = toDateKey(new Date());
  const yesterday = shiftDateKey(today, -1);
  dateHintEl.textContent = currentKey === today ? '今日の記録' : currentKey === yesterday ? '昨日の記録' : '';

  // 今日を表示中で、昨日がまだ記録されていないときだけ出す（責めない言い方で）
  const showNudge = currentKey === today && !loadRecords()[yesterday];
  nudgeBtn.hidden = !showNudge;
  const y = fromDateKey(yesterday);
  nudgeBtn.querySelector('.nudge-text').textContent = showNudge ? `昨日（${y.getMonth() + 1}/${y.getDate()}）の分もつける？` : '';
}

nudgeBtn.addEventListener('click', () => {
  if (openRecord(shiftDateKey(toDateKey(new Date()), -1))) focusRecordView(); // 押したボタンは隠れる
});

// 記録画面の先頭にフォーカスを移す（押したボタンが消えた・別の画面から移ってきたとき）。
// 日付欄に直接フォーカスすると、iPhone では日付の選択画面が開いてしまうので、画面そのものへ移す
function focusRecordView() {
  recordViewEl.focus({ preventScroll: true });
}

// ----- フォーム全体 -----
// 指定日の記録をフォームに反映（記録が無ければ空にする）
function fillForm(dateKey) {
  currentKey = dateKey;
  dateInput.value = dateKey;
  const r = loadRecords()[dateKey];
  setRadio('mood', r?.mood);
  setRadio('condition', r?.condition);

  sleepList.replaceChildren();
  const sleeps = r?.sleeps ?? [];
  if (sleeps.length === 0) addSleepRow(); // 睡眠が未登録なら空の1行から始める
  for (const s of sleeps) addSleepRow(s);
  updateSleepList();

  memoInput.value = r?.memo ?? '';
  effortInput.value = r?.effort ?? '';
  deleteBtn.hidden = !r;
  // 「編集中」は読み上げない枠に出す。保存時のお知らせと二重に読み上げられないように
  editStateEl.textContent = r ? `${formatDateJa(dateKey)}の記録を編集中` : '';
  recordStatusEl.textContent = '';
  formDirty = false;
  clearDraft(); // フォームを入れ替えたら、前の書きかけは要らない
  updateSameSleepBtn();
  updateDateInfo();
}

// 保存していない入力があれば、捨ててよいか確かめる
function confirmDiscard() {
  return !formDirty || confirm('保存していない入力があります。破棄して移動しますか？');
}

// 設定画面で記録を置き換えるときの確認文に添える一文
function draftDiscardNote() {
  return formDirty ? '\n記録画面の保存していない入力は破棄されます。' : '';
}

// ----- 書きかけの退避 -----
// iPhone は、裏に回したアプリを予告なく終了させることがある。
// 入力のたびに書きかけを localStorage に退避し、次に開いたときに戻す
function markDirty() {
  formDirty = true;
  const draft = {
    date: currentKey,
    mood: toScore(recordForm.elements.mood.value),
    condition: toScore(recordForm.elements.condition.value),
    sleeps: [...sleepList.children].map(readSleepRow),
    memo: memoInput.value,
    effort: effortInput.value,
  };
  writeStorage(DRAFT_KEY, JSON.stringify(draft)); // 書けなくても入力は続けられる
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // 消せなくても、次の入力で上書きされる
  }
}

// 退避した書きかけを読む。無い・形が崩れている・選べない日付なら null
function loadDraft() {
  let d;
  try {
    d = JSON.parse(localStorage.getItem(DRAFT_KEY));
  } catch {
    return null;
  }
  if (!d || typeof d !== 'object' || !isSelectableDate(d.date)) return null;
  const toTime = (v) => (TIME_PATTERN.test(v) ? v : '');
  return {
    date: d.date,
    mood: toScore(d.mood),
    condition: toScore(d.condition),
    sleeps: (Array.isArray(d.sleeps) ? d.sleeps : []).slice(0, MAX_SLEEPS)
      .map((s) => ({ start: toTime(s?.start), end: toTime(s?.end) })),
    memo: typeof d.memo === 'string' ? d.memo.slice(0, 100) : '',
    effort: typeof d.effort === 'string' ? d.effort.slice(0, 200) : '',
  };
}

// 書きかけをフォームに戻す（fillForm でその日を開いたあとに呼ぶ）
function restoreDraft(d) {
  setRadio('mood', d.mood);
  setRadio('condition', d.condition);
  sleepList.replaceChildren();
  if (d.sleeps.length === 0) addSleepRow();
  for (const s of d.sleeps) addSleepRow(s);
  updateSleepList();
  memoInput.value = d.memo;
  effortInput.value = d.effort;
  markDirty(); // fillForm で消えた退避を書き直す
  recordStatusEl.textContent = '保存していない入力を戻しました';
}

// すべて削除したあとなどに、記録画面を起動したときの状態に戻す
function resetRecordForm() {
  shownDefaultKey = defaultRecordDate();
  fillForm(shownDefaultKey);
}

// 他の画面（カレンダーの「編集する」など）から、指定日の記録を開く。移動をやめたら false
function openRecord(dateKey) {
  if (dateKey === currentKey && formDirty) return true; // 同じ日の書きかけはそのまま残す
  if (!confirmDiscard()) return false;
  fillForm(dateKey);
  return true;
}

// 記録が外で変わったとき（設定画面での読み込みなど）に、フォームを最新にする
function reloadRecordForm() {
  fillForm(currentKey);
}

// アプリに戻ったときに呼ぶ（main.js）。起動したまま日付が変わっていたら true を返す
function refreshToday() {
  const today = toDateKey(new Date());
  const dayChanged = today !== lastSeenToday;
  lastSeenToday = today;
  dateInput.max = today; // 未来の日付は選べない。上限も今日に合わせ直す

  const newDefault = defaultRecordDate();
  if (newDefault !== shownDefaultKey) {
    const wasOnDefault = currentKey === shownDefaultKey;
    shownDefaultKey = newDefault;
    // 前の初期値のまま何も入力していなければ、新しい日へ移す。入力中なら消さずに知らせるだけ。
    // 自分で別の日を開いていたときは、そのままにする
    if (wasOnDefault && !formDirty) {
      fillForm(newDefault);
      return dayChanged;
    }
    if (wasOnDefault) showToast({ icon: '📅', text: `日付が変わりました（今日は${formatDateJa(today)}）` });
  }
  updateDateInfo();
  return dayChanged;
}

// 何か入力・選択したら「保存していない入力あり」にする（日付欄の変更は除く）
// エラーなどの一言は、次に何か入力したら消す（直した後もエラーが残らないように）
recordForm.addEventListener('input', (e) => {
  if (e.target === dateInput) return;
  markDirty();
  recordStatusEl.textContent = '';
});

// 入力欄にフォーカスしたとき、画面下に貼りついた保存ボタンの帯に隠れていたら、見える位置までスクロールする。
// ブラウザ自身のスクロールが済んでから確かめるため、次の描画のタイミングで行う
recordForm.addEventListener('focusin', (e) => {
  if (!e.target.matches('input:not([type="radio"]), textarea')) return;
  requestAnimationFrame(() => {
    if (e.target.getBoundingClientRect().bottom > saveBarEl.getBoundingClientRect().top) {
      e.target.scrollIntoView({ block: 'center' });
    }
  });
});

// 日付欄で選べる日か（2000年1月1日〜今日の、実在する日）
function isSelectableDate(key) {
  return isDateKey(key) && key >= MIN_DATE_KEY && key <= toDateKey(new Date());
}

// PC では年を1桁打つたびに change が来る（"0002-09-14" など）。
// 選べない値のあいだは何もせず、打ち終わるのを待つ。値も戻さない（戻すと続きを打てない）
dateInput.addEventListener('change', () => {
  const key = dateInput.value;
  if (!isSelectableDate(key) || key === currentKey) return;
  if (!confirmDiscard()) {
    dateInput.value = currentKey; // 書きかけを捨てないと決めたときは、元の日付に戻す
    return;
  }
  fillForm(key);
});

// 欄を離れたときに選べない値のままなら、表示中の日付に戻す
dateInput.addEventListener('blur', () => {
  if (!isSelectableDate(dateInput.value)) dateInput.value = currentKey;
});

// メモ欄で改行キーを押すと、フォームが送信（保存）されてしまうので止める。
// 日本語の変換を確定する Enter（isComposing）はそのまま通す
memoInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  memoInput.blur(); // キーボードを閉じる
});

// エラーを保存ボタンのすぐ上に出し、直すべき欄へ移動する
function showFieldError(message, focusEl) {
  recordStatusEl.textContent = message;
  focusEl.scrollIntoView({ block: 'center' });
  focusEl.focus({ preventScroll: true });
}

recordForm.addEventListener('submit', (e) => {
  e.preventDefault(); // フォーム送信によるページ再読み込みを止める

  const mood = Number(recordForm.elements.mood.value);
  const condition = Number(recordForm.elements.condition.value);
  if (!mood || !condition) {
    showFieldError('気分と体調を選んでください', recordForm.elements[mood ? 'condition' : 'mood'][0]);
    return;
  }

  // 両方空の行は「未入力」として捨てる。片方だけ・同じ時刻の行があれば、その欄へ案内する
  const sleeps = [];
  for (const row of sleepList.children) {
    const s = readSleepRow(row);
    if (s.start === '' && s.end === '') continue;
    if (!isValidSleep(s)) {
      showFieldError('睡眠は寝た時刻と起きた時刻の両方を入れてください（同じ時刻は不可）',
        row.querySelector(s.start === '' ? '.sleep-start' : '.sleep-end'));
      return;
    }
    sleeps.push(s);
  }

  const records = loadRecords();
  records[currentKey] = {
    ...records[currentKey], // 画面に無い項目（将来の項目など）は残す
    mood,
    condition,
    sleeps,
    memo: memoInput.value.trim(),
    effort: effortInput.value.trim(),
  };
  if (!saveRecords(records)) {
    recordStatusEl.textContent = saveErrorMessage();
    return;
  }
  fillForm(currentKey); // 空の睡眠行を片付け、「編集中」の表示にする
  const cheer = cheerFor(mood, condition); // 気分・体調に合わせた言葉を返す
  showToast({ icon: cheer.icon, title: `${formatDateJa(currentKey)}を記録しました`, text: cheer.text });
});

deleteBtn.addEventListener('click', () => {
  if (!confirm(`${formatDateJa(currentKey)}の記録を削除しますか？`)) return;

  const records = loadRecords();
  delete records[currentKey];
  if (!saveRecords(records)) {
    recordStatusEl.textContent = saveErrorMessage();
    return;
  }
  fillForm(currentKey);
  showToast({ text: '削除しました' });
});

// ----- 初期化 -----
buildScale(document.getElementById('mood-scale'), 'mood', MOODS);
buildScale(document.getElementById('condition-scale'), 'condition', CONDITIONS);
dateInput.min = MIN_DATE_KEY;
dateInput.max = lastSeenToday;
shownDefaultKey = defaultRecordDate();
// 前回、保存せずに閉じた書きかけがあれば、その日を開いて戻す
const savedDraft = loadDraft();
fillForm(savedDraft?.date ?? shownDefaultKey);
if (savedDraft) restoreDraft(savedDraft);
