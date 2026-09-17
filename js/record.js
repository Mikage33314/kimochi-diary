// ===== 記録画面：入力フォーム =====
// 保存・書きかけの退避は storage.js の関数を使う（ここでは localStorage に直接触らない）
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
const sleepHintEl = document.getElementById('sleep-hint');
const sleepTemplate = document.getElementById('sleep-row-template');
const addSleepBtn = document.getElementById('add-sleep');
const sameSleepBtn = document.getElementById('same-sleep');
const nudgeBtn = document.getElementById('yesterday-nudge');
const saveBtn = document.getElementById('save-btn');
const saveHintEl = document.getElementById('save-hint');             // 保存ボタンの読み上げ用の説明（押せない理由）
const recordAnnounceEl = document.getElementById('record-announce'); // 見た目には出さず、読み上げだけで知らせる一言

let currentKey = '';                        // フォームに表示中の日付
let shownDefaultKey = '';                   // 「記録する日」の初期値として最後に使った日付
let lastSeenToday = toDateKey(new Date());  // 日付が変わったかの判定用
let formDirty = false;                      // 保存していない入力があるか（isFormChanged の結果。markDirty で計算し直す）
let prevSleeps = null;                      // 「前回と同じ」で入れる睡眠
const selectedScale = { mood: null, condition: null }; // 押す前に選んでいた値（もう一度押したら外すため）
const SCALE_NAMES = { mood: '気分', condition: '体調' };

// ----- 5段階ボタン -----
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
  selectedScale[name] = toScore(value);
  updateScaleHint(name);
}

// 選んでいるボタンにだけ「もう一度押すと外れます」の説明を付ける（ラジオボタンは本来外せない部品なので、読み上げで伝える）
function updateScaleHint(name) {
  for (const el of recordForm.elements[name]) {
    if (el.checked) el.setAttribute('aria-describedby', 'scale-clear-hint');
    else el.removeAttribute('aria-describedby');
  }
}

// 選んでいる顔をもう一度押したら、選択を外す。読み上げの操作（ダブルタップ）で押したときも click が来る。
// click は change より先に来るので、selectedScale は「押す前に選んでいた値」のまま比べられる
function isRadio(el) {
  return el instanceof HTMLInputElement && el.type === 'radio';
}

function clearScale(el) {
  el.checked = false;
  selectedScale[el.name] = null;
  updateScaleHint(el.name);
  markDirty();
  recordStatusEl.textContent = '';
  recordAnnounceEl.textContent = `${SCALE_NAMES[el.name]}の選択を外しました`;
}

let clearedByKey = null; // スペースキーで外した直後のボタン（続けて来る click で選び直さないように）

recordForm.addEventListener('click', (e) => {
  const el = e.target;
  if (!isRadio(el)) return;
  if (clearedByKey === el) {
    // click を取り消して、外した状態に戻す。何も選ばれていないグループでは、取り消しても選択を戻さないブラウザ（WebKit）があるので、自分でも外す
    el.checked = false;
    e.preventDefault();
    return;
  }
  if (selectedScale[el.name] === toScore(el.value)) clearScale(el); // 別の顔を選んだときは change で記録する
});

// キーボード：選んでいるボタンでスペースキーを押しても click が来ないブラウザ（Chrome など）があるので、キーで受ける
recordForm.addEventListener('keydown', (e) => {
  const el = e.target;
  if (e.key !== ' ' || !isRadio(el) || !el.checked || selectedScale[el.name] !== toScore(el.value)) return;
  e.preventDefault();
  clearScale(el);
  clearedByKey = el;
});
// キーを離したのがフォームの外（押している間にフォーカスが移った）でも解除する。フォームで受けると解除されず、ラジオボタンを押しても選べなくなる
document.addEventListener('keyup', (e) => {
  if (e.key === ' ' && clearedByKey) setTimeout(() => { clearedByKey = null; }); // keyup の後に来る click まで待つ
});

// 選んでいた値は、グループで今選ばれている値にする（e.target の値ではなく）。
// 選んでいる顔を押して外した後に、WebKit は外れたボタンで input・change を出すため
recordForm.addEventListener('change', (e) => {
  if (e.target.type !== 'radio') return;
  selectedScale[e.target.name] = toScore(recordForm.elements[e.target.name].value);
  updateScaleHint(e.target.name);
});

// ----- 睡眠リスト -----
function readSleepRow(row) {
  return {
    start: row.querySelector('.sleep-start').value,
    end: row.querySelector('.sleep-end').value,
  };
}

// <template> の中身を複製して1行追加する
function appendSleepRow(sleep = { start: '', end: '' }) {
  const row = sleepTemplate.content.firstElementChild.cloneNode(true);
  row.querySelector('.sleep-start').value = sleep.start;
  row.querySelector('.sleep-end').value = sleep.end;
  sleepList.appendChild(row);
}

// 睡眠の行をまとめて入れ替える。0件なら空の1行から始める
function setSleepRows(sleeps) {
  sleepList.replaceChildren();
  if (sleeps.length === 0) appendSleepRow();
  for (const s of sleeps) appendSleepRow(s);
  updateSleepList();
}

// 睡眠の行が、まだ記録にならない理由（片方だけ・同じ時刻・ほかの睡眠と重なる）。記録になる行・空の行は ''
function sleepRowProblem({ start, end }, overlapped) {
  if (!start && !end) return '';
  if (!start || !end) return '寝た時刻と起きた時刻の両方を入れてください';
  if (start === end) return '寝た時刻と起きた時刻は、違う時刻にしてください';
  return overlapped ? 'ほかの睡眠と時間が重なっています' : '';
}

// 記録になる睡眠：両方の時刻があって違う時刻で、ほかの睡眠と時間が重ならない件だけ
function completeSleeps(sleeps) {
  const valid = sleeps.filter(isValidSleep);
  const overlaps = overlappingSleeps(valid);
  return valid.filter((_, i) => !overlaps.has(i));
}

// 各行の睡眠時間と合計を表示し直す。＋ボタンは上限に達したら隠す
function updateSleepList() {
  let total = 0;
  const rows = [...sleepList.children];
  const values = rows.map(readSleepRow);
  // 重なりは、両方の時刻がある行どうしで比べ、行の番号に直す
  const validIndexes = values.flatMap((s, i) => (isValidSleep(s) ? [i] : []));
  const overlapped = new Set([...overlappingSleeps(validIndexes.map((i) => values[i]))].map((k) => validIndexes[k]));
  rows.forEach((row, i) => {
    const s = values[i];
    const hours = isValidSleep(s) ? sleepHours(s) : 0;
    row.querySelector('.sleep-hours').textContent = hours ? formatHours(hours) : '';
    // 読み上げで行を区別できるよう、何件目かをラベルに入れる
    const startInput = row.querySelector('.sleep-start');
    const endInput = row.querySelector('.sleep-end');
    startInput.setAttribute('aria-label', `寝た時刻（${i + 1}件目）`);
    endInput.setAttribute('aria-label', `起きた時刻（${i + 1}件目）`);
    row.querySelector('.remove-sleep-btn').setAttribute('aria-label', `この睡眠を取り消す（${i + 1}件目）`);
    // 片方だけ・同じ時刻・ほかの睡眠と重なる行は、その行のすぐ下に案内を出す（この行はまだ記録にならず、保存ボタンも押せる理由にならない）。
    // 時刻の欄の説明にもつなぎ、読み上げでも伝わるようにする
    const hint = row.querySelector('.sleep-row-hint');
    hint.id = `sleep-row-hint-${i + 1}`;
    hint.textContent = sleepRowProblem(s, overlapped.has(i));
    hint.hidden = !hint.textContent;
    for (const input of [startInput, endInput]) {
      if (hint.hidden) input.removeAttribute('aria-describedby');
      else input.setAttribute('aria-describedby', hint.id);
    }
    total += hours;
  });
  sleepTotalEl.textContent = total ? `合計 ${formatHours(total)}` : '';
  addSleepBtn.hidden = sleepList.children.length >= MAX_SLEEPS;
}

// 「前回（9/12）と同じ 23:00〜07:00」。表示中の日より前で、睡眠を記録した一番新しい日の時刻を入れる。
// "YYYY-MM-DD" は文字列のまま大小を比べられる
function updateSameSleepBtn(records) {
  const key = Object.keys(records)
    .filter((k) => k < currentKey && recordSleeps(records[k]).length > 0)
    .sort()
    .pop();
  prevSleeps = key ? recordSleeps(records[key]) : null;
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
  row.remove();
  updateSleepList();
  markDirty(); // 空の行を足して取り消しただけなら、変更なしのまま
  addSleepBtn.focus(); // 押したボタンが消えるので、フォーカスを「＋」へ移す
});

addSleepBtn.addEventListener('click', () => {
  if (sleepList.children.length >= MAX_SLEEPS) return;
  appendSleepRow();
  updateSleepList();
});

sameSleepBtn.addEventListener('click', () => {
  setSleepRows(prevSleeps);
  markDirty();
});

// ----- 日付 -----
// 日付欄の横の「今日の記録／昨日の記録」と、「昨日の分もつける？」を更新する
function updateDateInfo(records) {
  const today = toDateKey(new Date());
  const yesterday = shiftDateKey(today, -1);
  dateHintEl.textContent = currentKey === today ? '今日の記録' : currentKey === yesterday ? '昨日の記録' : '';

  // 今日を表示中で、昨日がまだ記録されていないときだけ出す（責めない言い方で）。
  // 記録が1件もない初回は出さない（始めたばかりの人に、いきなり昨日のことを聞かない）。
  // 「記録あり」は hasAnyEntry で判断する（管理用の情報だけの日は数えない）
  const showNudge = currentKey === today && !hasAnyEntry(records[yesterday]) && Object.values(records).some(hasAnyEntry);
  nudgeBtn.hidden = !showNudge;
  const y = fromDateKey(yesterday);
  nudgeBtn.querySelector('.nudge-text').textContent = showNudge ? `昨日（${y.getMonth() + 1}/${y.getDate()}）の分もつける？` : '';
  updateSleepHint(today);
}

// 睡眠の見出しの下の一文。睡眠は起きた日の記録に入るので、表示中の日の「前の夜〜その日の朝」を示す
// （夜に記録する人が、これから寝る時間を入れるのか迷わないように）
function updateSleepHint(today) {
  const md = (key) => {
    const d = fromDateKey(key);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };
  const prev = md(shiftDateKey(currentKey, -1));
  const cur = md(currentKey);
  // 夜に寝る人向けの「ゆうべ〜けさ」は例として示し、決まりは「目が覚めた日」で伝える（夜勤の人や、昼にまとめて寝る人もいるため）。
  // 「起きた日」だと「出来事が起きた日」とも読めるので、「目が覚めた日」にする
  const range = currentKey === today ? 'ゆうべ〜けさ' : `${prev}の夜〜${cur}の朝`;
  // 2つ目の睡眠を「昼寝」と決めつけない（夜勤の人や、昼にまとめて寝る人もいるため）
  const texts = [`${range}など、`, `目が覚めた日が${cur}の`, '睡眠を入れます。', '睡眠時間は「＋」で追加できます'];
  // 見える案内は語句ごとにひとかたまりにし、折り返すときは語句の切れ目で改行する（「入／れます」「睡眠／時間は」のように切れないように）
  const part = (text) => Object.assign(document.createElement('span'), { className: 'hint-part', textContent: text });
  sleepHintEl.replaceChildren(...texts.map(part));
  // 読み上げ用には、区切りの無い1つの文として入れる（かたまりのままだと、間に空白を入れて読まれるため）
  document.getElementById('sleep-hint-text').textContent = texts.join('');
}

nudgeBtn.addEventListener('click', () => {
  if (openRecord(shiftDateKey(toDateKey(new Date()), -1))) focusRecordView(); // 押したボタンは隠れる
});

// 記録画面の先頭にフォーカスを移す（押したボタンが消えた・別の画面から移ってきたとき）。
// 日付欄に直接フォーカスすると、iPhone では日付の選択画面が開いてしまうので、画面そのものへ移す
function focusRecordView() {
  recordViewEl.focus({ preventScroll: true });
}

// PC では年を1桁打つたびに change が来る（"0002-09-14" など）。
// 記録できない値のあいだは何もせず、打ち終わるのを待つ。値も戻さない（戻すと続きを打てない）
dateInput.addEventListener('change', () => {
  const key = dateInput.value;
  if (!isRecordableDate(key) || key === currentKey) return;
  if (!confirmDiscard()) {
    dateInput.value = currentKey; // 書きかけを捨てないと決めたときは、元の日付に戻す
    return;
  }
  fillForm(key);
});

// 欄を離れたときに記録できない値のままなら、表示中の日付に戻す
dateInput.addEventListener('blur', () => {
  if (!isRecordableDate(dateInput.value)) dateInput.value = currentKey;
});

// ----- フォーム全体 -----
// 指定日の記録をフォームに反映（記録が無ければ空にする）
function fillForm(dateKey) {
  const records = loadRecords();
  const r = records[dateKey];
  currentKey = dateKey;
  dateInput.value = dateKey;
  setRadio('mood', r?.mood);
  setRadio('condition', r?.condition);
  setSleepRows(r?.sleeps ?? []);
  memoInput.value = r?.memo ?? '';
  effortInput.value = r?.effort ?? '';
  syncGrow(memoInput);
  syncGrow(effortInput);
  const recorded = hasAnyEntry(r); // 管理用の情報だけの日は、記録の無い日として開く
  deleteBtn.hidden = !recorded;
  // 「編集中」は読み上げない枠に出す。保存時のお知らせと二重に読み上げられないように
  editStateEl.textContent = recorded ? `${formatDateJa(dateKey)}の記録を編集中` : '';
  recordStatusEl.textContent = '';
  recordAnnounceEl.textContent = '';
  formDirty = false;
  clearDraft(); // フォームを入れ替えたら、前の書きかけは要らない
  updateSameSleepBtn(records);
  updateDateInfo(records);
  updateSaveButton();
}

// ----- 変更の判定と保存ボタン -----
// 画面の入力を、保存と同じ形で読む（検査はしない）。
// 睡眠は時刻が入っている行だけ（片方だけの行も含む）。メモ・頑張ったことは前後の空白を除く
function readFormState() {
  return {
    mood: toScore(recordForm.elements.mood.value),
    condition: toScore(recordForm.elements.condition.value),
    sleeps: [...sleepList.children].map(readSleepRow).filter((s) => s.start || s.end),
    memo: memoInput.value.trim(),
    effort: effortInput.value.trim(),
  };
}

// 保存済みの記録から変わっているか。「保存していない入力があるか」の判定は、すべてここを通す
// （選んで外して元に戻したら、変更なしに戻る）。項目ごとに RECORD_ITEMS の equals で比べる。
// メモは保存済みの方も前後の空白を除いて比べ、睡眠は片方だけの行も「変更」に数える。
// 入力欄（textarea）は改行の \r\n・\r を \n にして持つので、保存済みの方もそろえてから比べる（読み込んだ記録など）
function isFormChanged(state, saved) {
  return RECORD_ITEM_KEYS.some((key) => {
    const result = RECORD_ITEMS[key].normalize(saved?.[key]);
    const before = 'value' in result ? result.value : null;
    return !RECORD_ITEMS[key].equals(state[key], typeof before === 'string' ? before.replace(/\r\n?/g, '\n').trim() : before);
  });
}

// 保存ボタンの状態を決める材料。
// canSave：変更があり、保存した後の記録に項目が1つ以上ある（睡眠の片方だけ・同じ時刻・ほかの睡眠と重なる行は、項目に数えない）
function formSaveState() {
  const saved = loadRecords()[currentKey];
  const state = readFormState();
  const changed = isFormChanged(state, saved);
  const after = applyRecordEdit(saved, { ...state, sleeps: completeSleeps(state.sleeps) }, RECORD_ITEM_KEYS);
  return { changed, canSave: changed && after !== null, recorded: hasAnyEntry(saved) };
}

// 押せないときは aria-disabled にする（disabled にすると、保存した直後にフォーカスがボタンから外れて迷子になるため）。
// 押せない理由は画面に常には出さず、読み上げ用の説明だけにする
function updateSaveButton(s = formSaveState()) {
  saveBtn.setAttribute('aria-disabled', String(!s.canSave));
  if (!s.canSave && s.recorded && !s.changed) {
    const check = Object.assign(document.createElement('span'), { textContent: ' ✓' });
    check.setAttribute('aria-hidden', 'true'); // 読み上げは「保存済み」だけにする
    saveBtn.replaceChildren('保存済み', check);
  } else {
    saveBtn.textContent = '保存する';
  }
  saveHintEl.textContent = s.canSave ? ''
    : !s.changed && s.recorded ? '変更はありません'
      : s.recorded ? '記録する項目を1つ以上入れると保存できます。この日の記録を消すときは「この日の記録を削除」を押します'
        : '記録する項目を1つ以上入れると保存できます';
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
// 入力のたびに書きかけを退避し（storage.js の saveDraft）、次に開いたときに戻す。
// 保存済みの記録と同じに戻ったら、変更なしにして書きかけも消す
function markDirty() {
  const s = formSaveState();
  formDirty = s.changed;
  if (formDirty) {
    saveDraft({
      date: currentKey,
      mood: toScore(recordForm.elements.mood.value),
      condition: toScore(recordForm.elements.condition.value),
      sleeps: [...sleepList.children].map(readSleepRow),
      memo: memoInput.value,
      effort: effortInput.value,
    });
  } else {
    clearDraft();
  }
  updateSaveButton(s);
}

// 書きかけをフォームに戻す（fillForm でその日を開いたあとに呼ぶ）
function restoreDraft(d) {
  setRadio('mood', d.mood);
  setRadio('condition', d.condition);
  setSleepRows(d.sleeps);
  memoInput.value = d.memo;
  effortInput.value = d.effort;
  syncGrow(memoInput);
  syncGrow(effortInput);
  markDirty(); // fillForm で消えた退避を書き直す（保存済みと同じ中身なら、変更なしのまま）
  if (formDirty) recordStatusEl.textContent = '保存していない入力を戻しました';
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
  updateDateInfo(loadRecords());
  return dayChanged;
}

// 何か入力・選択したら「保存していない入力あり」にする（日付欄の変更は除く）。
// 時刻欄などは、環境によって input を出さず change だけのことがあるので、両方で受ける。
// エラーなどの一言は、次に何か入力したら消す（直した後もエラーが残らないように）
for (const type of ['input', 'change']) {
  recordForm.addEventListener(type, (e) => {
    if (e.target === dateInput) return;
    markDirty();
    recordStatusEl.textContent = '';
    // 選択を外した直後に WebKit が出す input・change（外れたボタンから来る）では、「選択を外しました」を消さない
    if (!(isRadio(e.target) && !e.target.checked)) recordAnnounceEl.textContent = '';
  });
}

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

// メモ欄で改行キーを押しても、改行は入れずにキーボードを閉じる（メモは「ひとこと」なので1段落にする）。
// 日本語の変換を確定する Enter（isComposing）はそのまま通す
memoInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  memoInput.blur(); // キーボードを閉じる
});

// 念のための備え：上のキーの判定をすり抜けて改行が入りそうなとき（キーボードによっては Enter のキー番号が 229 になる など）も、
// 改行は入れずにキーボードを閉じる。変換の確定では改行は入らないので、ここには来ない
memoInput.addEventListener('beforeinput', (e) => {
  if (e.inputType !== 'insertLineBreak' && e.inputType !== 'insertParagraph') return;
  e.preventDefault();
  memoInput.blur();
});

// 文字の量に合わせて伸びる欄（style.css の .grow-wrap）：見えない写しに同じ文字を入れて、欄の高さを決めさせる
function syncGrow(el) {
  el.parentElement.dataset.value = el.value;
}

// 貼り付けなどで入った改行は空白にする。直したら true。
// 値を入れ直すとカーソルが末尾へ飛ぶので、元の位置に戻す（改行1文字を空白1文字にするので、位置はずれない）
function replaceMemoLineBreaks() {
  if (!/[\r\n]/.test(memoInput.value)) return false;
  const caret = memoInput.selectionStart;
  memoInput.value = memoInput.value.replace(/\r\n?|\n/g, ' ');
  if (document.activeElement === memoInput) memoInput.setSelectionRange(caret, caret);
  return true;
}

// フォーム全体の input（書きかけの退避）より先に動くので、直した文字が退避される。
// 日本語の変換中は直さない（値を入れ直すと変換が途切れ、「かき→柿」が「か柿」のように二重になる。
// 改行入りの記録を読み込んだメモに、変換で書き足したときに起きる）。変換が終わってから直す
memoInput.addEventListener('input', (e) => {
  if (!e.isComposing) replaceMemoLineBreaks();
  syncGrow(memoInput);
});
memoInput.addEventListener('compositionend', () => {
  if (!replaceMemoLineBreaks()) return;
  // 見えない写しと退避も、直した文字にする（Chrome などは変換の確定の後に input が来ないため、
  // 写しが改行入りのまま残り、欄が1行ぶん高くなる）
  syncGrow(memoInput);
  markDirty();
});
effortInput.addEventListener('input', () => syncGrow(effortInput));

// エラーを保存ボタンのすぐ上に出し、直すべき欄へ移動する
function showFieldError(message, focusEl) {
  recordStatusEl.textContent = message;
  focusEl.scrollIntoView({ block: 'center' });
  focusEl.focus({ preventScroll: true });
}

// 入力を検査して、保存する形にする。問題があればエラーを出して null。
// 記録の項目はすべて任意なので、選んでいない気分・体調は null のまま渡す（applyRecordEdit がその項目を消す）
function readForm() {
  const mood = toScore(recordForm.elements.mood.value);
  const condition = toScore(recordForm.elements.condition.value);

  // 両方空の行は「未入力」として捨てる。片方だけ・同じ時刻の行があれば、その欄へ案内する（勝手に捨てない）
  const sleeps = [];
  const sleepRows = [];
  for (const row of sleepList.children) {
    const s = readSleepRow(row);
    if (s.start === '' && s.end === '') continue;
    if (!isValidSleep(s)) {
      showFieldError('睡眠は寝た時刻と起きた時刻の両方を入れてください（同じ時刻は不可）',
        row.querySelector(s.start === '' ? '.sleep-start' : '.sleep-end'));
      return null;
    }
    sleeps.push(s);
    sleepRows.push(row);
  }
  // 睡眠どうしの時間が重なっていたら、最初に重なっている行へ案内する（どちらが正しいか分からないので、勝手に捨てない）
  const overlaps = overlappingSleeps(sleeps);
  if (overlaps.size) {
    showFieldError('睡眠の時間が重なっています。寝た時刻と起きた時刻を直してください',
      sleepRows[Math.min(...overlaps)].querySelector('.sleep-start'));
    return null;
  }

  // 文字数は保存データの検査と同じ数え方で確かめる（古い Safari は入力欄の上限を別の数え方で守るため）
  const memo = memoInput.value.trim();
  const effort = effortInput.value.trim();
  if (memo.length > MEMO_MAX) {
    showFieldError(`ひとことメモは${MEMO_MAX}文字までです（絵文字は2文字と数えます）`, memoInput);
    return null;
  }
  if (effort.length > EFFORT_MAX) {
    showFieldError(`頑張ったことは${EFFORT_MAX}文字までです（絵文字は2文字と数えます）`, effortInput);
    return null;
  }
  return { mood, condition, sleeps, memo, effort };
}

recordForm.addEventListener('submit', (e) => {
  e.preventDefault(); // フォーム送信によるページ再読み込みを止める
  // 押せない状態（変更なし・記録する項目なし）では保存しない。日付欄で Enter を押したときなども、ここで止まる。
  // 見えているボタンが押せない表示のときも保存しない（別のタブで同じ日が保存され、表示が古くなっていたとき、
  // 「保存済み ✓」を押して古い入力で上書きしないように）。止めたときは、ボタンと書きかけを今の保存データに合わせ直す。
  // 入力が無い（formDirty が false）のに保存データと違うのは、別のタブで保存・削除されて表示が古いとき。
  // 入力は無いので、最新の記録で開き直す（markDirty だと古い表示の値が「保存していない入力」になって書きかけにも残り、
  // 次に押したときや開き直して戻したときに、新しい記録を古い値で上書き・削除した日を作り直してしまう）
  const state = formSaveState();
  if (!state.canSave || saveBtn.getAttribute('aria-disabled') === 'true') {
    if (!formDirty && state.changed) fillForm(currentKey);
    else markDirty();
    return;
  }
  const input = readForm();
  if (!input) return;

  const records = loadRecords();
  // 入れ替えるのは記録画面に出している項目だけ。画面に無い項目（将来の項目など）は残し、空にした項目は消す
  const next = applyRecordEdit(records[currentKey], input, RECORD_ITEM_KEYS);
  if (next) records[currentKey] = next;
  else delete records[currentKey];
  if (!saveRecords(records)) {
    recordStatusEl.textContent = saveErrorMessage();
    return;
  }
  fillForm(currentKey); // 空の睡眠行を片付け、「編集中」の表示にする
  // 気分・体調に合わせた言葉を返す。どちらも無い日（睡眠だけ など）は言葉なしで、記録したことだけ伝える
  const cheer = cheerFor(input.mood, input.condition);
  showToast({ icon: cheer?.icon, title: `${formatDateJa(currentKey)}を記録しました`, text: cheer?.text ?? '', duration: 4000 });
});

deleteBtn.addEventListener('click', () => {
  if (!confirm(`${formatDateJa(currentKey)}の記録を削除しますか？`)) return;

  const key = currentKey;
  const records = loadRecords();
  const deleted = records[key];
  delete records[key];
  if (!saveRecords(records)) {
    recordStatusEl.textContent = saveErrorMessage();
    return;
  }
  fillForm(key);
  // 押し間違い（子どもが触った など）に備えて、5秒ほど「元に戻す」を出す
  showToast({ text: '削除しました', duration: 5000, action: { label: '元に戻す', onClick: () => undoDelete(key, deleted) } });
});

// 削除した記録を戻す。その間に同じ日を記録していたら、上書きしない
function undoDelete(key, record) {
  const records = loadRecords();
  if (hasAnyEntry(records[key])) return;
  records[key] = record;
  if (!saveRecords(records)) {
    showToast({ icon: '⚠️', text: saveErrorMessage(), duration: 6000 });
    return;
  }
  // 表示中の日なら、入力中でも戻した記録で開き直す（削除の後に入れた保存していない入力は捨てる）。
  // 入力を残すと、戻した記録（メモなど）が画面に出ないまま、保存で消えてしまうため（2026-09-17 ユーザーと決定）
  if (key === currentKey) fillForm(key);
  showToast({ icon: '↩️', text: `${formatDateJa(key)}の記録を元に戻しました` });
}

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
