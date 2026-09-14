// ===== 設定画面：項目の一覧 → 各ページ（バックアップ／データの削除／このアプリ）=====
// バックアップ（書き出し・読み込み・元に戻す）、取り分けたデータ、すべて削除、アプリの紹介。
// 保存まわりは storage.js の関数を使う（ここでは localStorage に直接触らない）
const MAX_IMPORT_BYTES = 5 * 1024 * 1024; // 読み込めるファイルの大きさの上限（5MB）
// 紹介で送るのは、公開中のアプリの URL だけ（開いている画面の URL ではなく、決まった URL を送る）
const APP_URL = 'https://mikage33314.github.io/kimochi-diary/';
const APP_NAME = 'Dear me+';
const SHARE_TEXT = `気分・体調・睡眠を1分で記録できる日記アプリ『${APP_NAME}』`;
const settingsMenuEl = document.getElementById('settings-menu');
const dataMenuDot = document.getElementById('data-menu-dot');
const shareBtn = document.getElementById('share-btn');
const shareStatusEl = document.getElementById('share-status');
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

// 「今日」「昨日」「3日前」
function daysAgoText(date) {
  const diff = Math.round((fromDateKey(toDateKey(new Date())) - fromDateKey(toDateKey(date))) / 86400000);
  if (diff <= 0) return '今日';
  return diff === 1 ? '昨日' : `${diff}日前`;
}

// 取り分けたデータのカードの説明文
function brokenNoteText(count) {
  if (storageLockReason === 'newer') {
    return '新しい版のアプリで保存した記録があるため、上書きしないよう保存を止めています。アプリを上にスワイプして閉じてから開き直すと、新しい版になります（アイコンは削除しないでください）。念のため「書き出す」で保管もできます。';
  }
  if (storageLockReason === 'rewrite') {
    return `保存データの一部が読めなかったため、元のデータを取り分けました（${count}件）。ただ、直して保存し直す空きがないため、保存を止めています。「書き出す」で保管してから「削除する」で空きを作ると、保存を再開します。`;
  }
  if (storageLocked) {
    return '保存データを読み込めず、取り分ける空きも無いため、上書きしないよう保存を止めています。まず「書き出す」で元のデータを保管してください。空きができると保存を再開します。';
  }
  return `保存データの一部が読めなかったため、元のデータを消さずに取っておきました（${count}件）。書き出して保管できます。`;
}

function renderSettings() {
  const count = Object.keys(loadRecords()).length; // ここで読み直すと、止めていた保存の再開も試される
  const last = readLastBackup();
  // 「まだありま／せん」のように途中で改行されないよう、日付の部分はひとかたまりにする
  const lastEl = document.createElement('span');
  lastEl.className = 'nowrap';
  lastEl.textContent = last ? `${formatDateJa(toDateKey(last))}（${daysAgoText(last)}）` : 'まだありません';
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
  brokenNoteEl.textContent = brokenNoteText(broken.length);
  dataMenuDot.hidden = brokenCard.hidden; // 一覧を見ていても気づけるように、「データの削除」の行に点を付ける
  shareStatusEl.textContent = '';
}

// 設定のページを切り替える。name が null なら項目の一覧。
// どのページを見ていたかは、アプリを開いている間だけ覚えておく（書き出しで共有シートから戻ってきても、同じページのまま）
function showSettingsPage(name) {
  settingsMenuEl.hidden = Boolean(name);
  for (const page of document.querySelectorAll('.settings-page')) page.hidden = page.dataset.page !== name;
}

// 一覧の行を押したら、そのページへ。押した行は隠れるので、フォーカスはページ名へ移す（読み上げでページ名が伝わる）
settingsMenuEl.addEventListener('click', (e) => {
  const row = e.target.closest('[data-page]');
  if (!row) return;
  showSettingsPage(row.dataset.page);
  window.scrollTo(0, 0);
  document.querySelector(`.settings-page[data-page="${row.dataset.page}"] .page-title`).focus({ preventScroll: true });
});

// 「‹」で一覧へ戻る。フォーカスは、さっき開いた項目の行へ戻す
for (const btn of document.querySelectorAll('.settings-page [data-back]')) {
  btn.addEventListener('click', () => {
    const name = btn.closest('.settings-page').dataset.page;
    showSettingsPage(null);
    window.scrollTo(0, 0);
    settingsMenuEl.querySelector(`[data-page="${name}"]`).focus({ preventScroll: true });
  });
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

// ファイル名からは中身が分からないようにする（共有シートや「ファイル」アプリで人目に触れるため）
exportBtn.addEventListener('click', async () => {
  const records = loadRecords();
  if (Object.keys(records).length === 0) {
    settingsStatusEl.textContent = '書き出す記録がまだありません';
    return;
  }
  const result = await shareOrDownload(`kd-backup-${toDateKey(new Date())}.json`, JSON.stringify(makeBackup(records), null, 2));
  if (result === 'cancelled') return;
  markBackedUp();
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

  const result = parseBackupText(await file.text());
  if (result.error) {
    settingsStatusEl.textContent = result.error;
    return;
  }
  const current = Object.keys(loadRecords()).length;
  if (storageLocked) {
    settingsStatusEl.textContent = saveErrorMessage();
    return;
  }
  // 除く記録の件数を、理由ごとに示す
  const notes = [];
  if (result.future) notes.push(`今日より後の日付の記録 ${result.future}件は除きます。`);
  if (result.dropped) notes.push(`読めない記録 ${result.dropped}件は除きます。`);
  if (result.changed) notes.push(`一部が読めない記録 ${result.changed}件は、読めた部分だけ入れます。`);
  const message = `${result.count}日分の記録を読み込みます。\n今の記録（${current}日分）はすべて置き換わります（あとで元に戻せます）。よろしいですか？`;
  if (!confirm([message, ...notes].join('\n') + draftDiscardNote())) return;

  const outcome = replaceRecords(result.records);
  if (outcome !== 'ok') {
    settingsStatusEl.textContent = outcome === 'no-space'
      ? '空き容量が足りず、今の記録を取っておけませんでした。先に「書き出す」で保管してください'
      : saveErrorMessage();
    return;
  }
  reloadRecordForm();
  renderSettings();
  showToast({ icon: '📥', title: `${result.count}日分を読み込みました`, text: '取り消すときは「元に戻す」を押してください' });
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
  clearBeforeImport();
  reloadRecordForm();
  renderSettings();
  showToast({ icon: '↩️', text: '読み込む前の記録に戻しました' });
});

undoImportDeleteBtn.addEventListener('click', () => {
  if (!confirm('読み込む前の記録を削除しますか？\n読み込みを取り消せなくなります')) return;
  clearBeforeImport();
  renderSettings();
  showToast({ text: '削除しました' });
});

brokenExportBtn.addEventListener('click', async () => {
  const result = await shareOrDownload(`kd-stash-${toDateKey(new Date())}.json`, JSON.stringify(collectStash(), null, 2));
  if (result !== 'cancelled') showToast({ text: '書き出しました' });
});

brokenDeleteBtn.addEventListener('click', () => {
  if (!confirm('取り分けたデータを削除しますか？元には戻せません')) return;
  const wasLocked = storageLocked;
  removeBrokenData();
  renderSettings(); // 空きができれば、ここで取り分けと保存の再開が行われる
  showToast({ text: wasLocked && !storageLocked ? '空きができたので、保存を再開しました' : '削除しました' });
});

// アプリを紹介する：共有シート（LINE・メッセージなど）で URL と紹介文を送る。
// 共有シートが無い・使えないときは、紹介文と URL をコピーする。それもできなければ、手でコピーしてもらう
shareBtn.addEventListener('click', async () => {
  shareStatusEl.textContent = '';
  if (navigator.share) {
    try {
      await navigator.share({ title: APP_NAME, text: SHARE_TEXT, url: APP_URL });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return; // 共有シートを閉じただけ
    }
  }
  try {
    await navigator.clipboard.writeText(`${SHARE_TEXT}\n${APP_URL}`);
    showToast({ icon: '🔗', text: '紹介文とリンクをコピーしました' });
  } catch {
    shareStatusEl.textContent = 'コピーできませんでした。上のリンクを長押し（PC では選んで右クリック）してコピーしてください';
  }
});

// 二重に確かめてから、このアプリのデータをすべて消す
deleteAllBtn.addEventListener('click', () => {
  const count = Object.keys(loadRecords()).length;
  if (!confirm(`記録（${count}日分）・取り分けたデータ・書きかけを、すべて削除します。\n元には戻せません。`)) return;
  if (!confirm('本当に削除しますか？\n書き出していない記録は、二度と見られなくなります。')) return;

  const left = removeAllData();
  resetRecordForm();
  renderSettings();
  // 知らせはお知らせで出す（settingsStatusEl はバックアップのページにあり、このページからは見えないため）
  if (left) showToast({ icon: '⚠️', text: `一部のデータを削除できませんでした（${left}件）`, duration: 6000 });
  else showToast({ text: 'すべてのデータを削除しました' });
});

document.getElementById('share-url').textContent = APP_URL;
