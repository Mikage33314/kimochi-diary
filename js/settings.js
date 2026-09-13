// ===== 設定画面：バックアップ（書き出し・読み込み・元に戻す）、取り分けたデータ、すべて削除 =====
const LAST_BACKUP_KEY = KEY_PREFIX + 'last-backup'; // 最後に書き出した日時（ISO 形式の文字列）
const MAX_IMPORT_BYTES = 5 * 1024 * 1024; // 読み込めるファイルの大きさの上限（5MB）
const exportBtn = document.getElementById('export-btn');
const importBtn = document.getElementById('import-btn');
const importFileInput = document.getElementById('import-file');
const backupInfoEl = document.getElementById('backup-info');
const settingsStatusEl = document.getElementById('settings-status');
const undoImportCard = document.getElementById('undo-import-card');
const undoImportInfoEl = document.getElementById('undo-import-info');
const undoImportBtn = document.getElementById('undo-import');
const undoImportDeleteBtn = document.getElementById('undo-import-delete');
const brokenCard = document.getElementById('broken-card');
const brokenNoteEl = document.getElementById('broken-note');
const brokenExportBtn = document.getElementById('broken-export');
const brokenDeleteBtn = document.getElementById('broken-delete');
const deleteAllBtn = document.getElementById('delete-all');

function readLastBackup() {
  try {
    const iso = localStorage.getItem(LAST_BACKUP_KEY);
    const d = iso ? new Date(iso) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  } catch {
    return null;
  }
}

// 読み込む前に取っておいた記録。無い・読めなければ null
function readBeforeImport() {
  let data;
  try {
    data = JSON.parse(localStorage.getItem(BEFORE_IMPORT_KEY));
  } catch {
    return null;
  }
  const result = normalizeRecords(data?.records);
  if (!result) return null;
  const savedAt = new Date(data.exportedAt);
  return { records: result.records, savedAt: Number.isNaN(savedAt.getTime()) ? null : savedAt };
}

// 「今日」「昨日」「3日前」
function daysAgoText(date) {
  const diff = Math.round((fromDateKey(toDateKey(new Date())) - fromDateKey(toDateKey(date))) / 86400000);
  if (diff <= 0) return '今日';
  return diff === 1 ? '昨日' : `${diff}日前`;
}

function renderSettings() {
  const count = Object.keys(loadRecords()).length; // ここで読み直すと、止めていた保存の再開も試される
  const last = readLastBackup();
  const lastText = last ? `${formatDateJa(toDateKey(last))}（${daysAgoText(last)}）` : 'まだありません';
  // 「まだありま／せん」のように途中で改行されないよう、日付の部分はひとかたまりにする
  const lastEl = document.createElement('span');
  lastEl.className = 'nowrap';
  lastEl.textContent = lastText;
  backupInfoEl.textContent = `記録 ${count}日分 ・ 前回のバックアップ：`;
  backupInfoEl.append(lastEl);
  settingsStatusEl.textContent = '';

  const before = readBeforeImport();
  undoImportCard.hidden = !before;
  if (before) {
    const when = before.savedAt ? `・${formatDateJa(toDateKey(before.savedAt))}に読み込み` : '';
    undoImportInfoEl.textContent = `${Object.keys(before.records).length}日分${when}`;
  }

  // 保存を止めているときは、取り分けが無くても出す（読めない元のデータを書き出せるように）
  const broken = listBrokenKeys();
  brokenCard.hidden = broken.length === 0 && !storageLocked;
  brokenDeleteBtn.hidden = broken.length === 0;
  brokenNoteEl.textContent = storageLocked
    ? '保存データを読み込めず、取り分ける空きも無いため、上書きしないよう保存を止めています。まず「書き出す」で元のデータを保管してください。空きができると保存を再開します。'
    : `保存データの一部が読めなかったため、元のデータを消さずに取っておきました（${broken.length}件）。書き出して保管できます。`;
}

// ファイルを端末に渡す。iPhone は共有シート（「"ファイル"に保存」を選べる）、使えなければダウンロード。
// 結果は 'shared'（共有した）/ 'downloaded'（ダウンロードした）/ 'cancelled'（共有シートを閉じた）
async function shareOrDownload(filename, text) {
  const file = new File([text], filename, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
      // それ以外（共有が許可されていない など）はダウンロードに切り替える
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'downloaded';
}

function makeBackup(records) {
  return { app: 'kimochi-diary', version: BACKUP_VERSION, exportedAt: new Date().toISOString(), records };
}

// ファイル名からは中身が分からないようにする（共有シートや「ファイル」アプリで人目に触れるため）
exportBtn.addEventListener('click', async () => {
  const records = loadRecords();
  if (Object.keys(records).length === 0) {
    settingsStatusEl.textContent = '書き出す記録がまだありません';
    return;
  }
  const result = await shareOrDownload(`kd-backup-${toDateKey(new Date())}.json`, JSON.stringify(makeBackup(records), null, 2));
  if (result === 'cancelled') return;
  writeStorage(LAST_BACKUP_KEY, new Date().toISOString()); // 日時を記録できなくても、書き出し自体は済んでいる
  renderSettings();
  showToast({ icon: '📦', text: '書き出しました' });
});

// 見た目の整ったボタンから、隠してあるファイル選択を開く
importBtn.addEventListener('click', () => importFileInput.click());

importFileInput.addEventListener('change', async () => {
  const file = importFileInput.files[0];
  importFileInput.value = ''; // 同じファイルをもう一度選んでも change が起きるように
  if (!file) return;
  if (file.size > MAX_IMPORT_BYTES) {
    settingsStatusEl.textContent = 'ファイルが大きすぎるため、読み込めません（5MB まで）';
    return;
  }

  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    settingsStatusEl.textContent = 'JSON ファイルとして読めませんでした';
    return;
  }

  // 書き出した形式 { app, version, records } と、記録だけの形式の両方を受け付ける。
  // 新しい版のアプリで書き出したファイルは、形式が変わっているかもしれないので読まない
  const isBackup = data?.app === 'kimochi-diary';
  if (isBackup && !(Number.isInteger(data.version) && data.version <= BACKUP_VERSION)) {
    settingsStatusEl.textContent = '新しい版のアプリで書き出したファイルのため、読み込めません';
    return;
  }
  // 中身は、起動時の読み込みと同じ normalizeRecords() で検査する。今日より後の日付は除く
  const result = normalizeRecords(isBackup ? data.records : data, { maxKey: toDateKey(new Date()) });
  const count = result ? Object.keys(result.records).length : 0;
  if (count === 0) {
    settingsStatusEl.textContent = 'きもち日記の記録が見つかりませんでした';
    return;
  }

  const currentRecords = loadRecords();
  if (storageLocked) {
    settingsStatusEl.textContent = saveErrorMessage();
    return;
  }
  const notes = [];
  if (result.dropped) notes.push(`読めない記録 ${result.dropped}件は除きます。`);
  if (result.changed) notes.push(`一部が読めない記録 ${result.changed}件は、読めた部分だけ入れます。`);
  const current = Object.keys(currentRecords).length;
  const message = `${count}日分の記録を読み込みます。\n今の記録（${current}日分）はすべて置き換わります（あとで元に戻せます）。よろしいですか？`;
  if (!confirm([message, ...notes].join('\n') + draftDiscardNote())) return;

  // 置き換える前に、今の記録を取っておく（「元に戻す」用。直前の1回分だけ）
  if (!writeStorage(BEFORE_IMPORT_KEY, JSON.stringify(makeBackup(currentRecords)))) {
    settingsStatusEl.textContent = '空き容量が足りず、今の記録を取っておけませんでした。先に「書き出す」で保管してください';
    return;
  }
  if (!saveRecords(result.records)) {
    localStorage.removeItem(BEFORE_IMPORT_KEY); // 置き換えていないので、取っておく必要もない
    settingsStatusEl.textContent = saveErrorMessage();
    return;
  }
  reloadRecordForm();
  renderSettings();
  showToast({ icon: '📥', title: `${count}日分を読み込みました`, text: '取り消すときは「元に戻す」を押してください' });
});

undoImportBtn.addEventListener('click', () => {
  const before = readBeforeImport();
  if (!before) {
    renderSettings();
    return;
  }
  const current = Object.keys(loadRecords()).length;
  const message = `読み込む前の記録（${Object.keys(before.records).length}日分）に戻します。\n今の記録（${current}日分）は置き換わります。よろしいですか？`;
  if (!confirm(message + draftDiscardNote())) return;

  if (!saveRecords(before.records)) {
    settingsStatusEl.textContent = saveErrorMessage();
    return;
  }
  localStorage.removeItem(BEFORE_IMPORT_KEY);
  reloadRecordForm();
  renderSettings();
  showToast({ icon: '↩️', text: '読み込む前の記録に戻しました' });
});

undoImportDeleteBtn.addEventListener('click', () => {
  if (!confirm('読み込む前の記録を削除しますか？\n読み込みを取り消せなくなります')) return;
  localStorage.removeItem(BEFORE_IMPORT_KEY);
  renderSettings();
  showToast({ text: '削除しました' });
});

brokenExportBtn.addEventListener('click', async () => {
  const items = {};
  for (const key of listBrokenKeys()) {
    try {
      items[key] = localStorage.getItem(key);
    } catch {
      // 読めないものは飛ばす
    }
  }
  // 保存を止めている間は、読めなかった保存データそのものも入れる
  if (storageLocked) items[STORAGE_KEY] = readRawRecords();
  const result = await shareOrDownload(`kd-stash-${toDateKey(new Date())}.json`, JSON.stringify(items, null, 2));
  if (result !== 'cancelled') showToast({ text: '書き出しました' });
});

brokenDeleteBtn.addEventListener('click', () => {
  if (!confirm('取り分けたデータを削除しますか？元には戻せません')) return;
  const wasLocked = storageLocked;
  for (const key of listBrokenKeys()) {
    try {
      localStorage.removeItem(key);
    } catch {
      // 消せないものは残る（次に開いたときにまた表示される）
    }
  }
  renderSettings(); // 空きができれば、ここで取り分けと保存の再開が行われる
  showToast({ text: wasLocked && !storageLocked ? '空きができたので、保存を再開しました' : '削除しました' });
});

// 二重に確かめてから、このアプリのデータをすべて消す
deleteAllBtn.addEventListener('click', () => {
  const count = Object.keys(loadRecords()).length;
  if (!confirm(`記録（${count}日分）・取り分けたデータ・書きかけを、すべて削除します。\n元には戻せません。`)) return;
  if (!confirm('本当に削除しますか？\n書き出していない記録は、二度と見られなくなります。')) return;

  const left = removeAllData();
  resetRecordForm();
  renderSettings();
  if (left) settingsStatusEl.textContent = `一部のデータを削除できませんでした（${left}件）`;
  else showToast({ text: 'すべてのデータを削除しました' });
});
