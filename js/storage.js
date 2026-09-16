// ===== 保存（localStorage）：データの検査・読み書き・取り分け・書きかけ・バックアップ =====
// localStorage に触るのはこのファイルだけ。画面のファイル（record.js など）はここの関数を使う。
//
// 記録を消さないために守っていること
// - 読むたびに形を検査する。内容が減る直し方をするときは、先に元の文字列を取り分ける
// - 取り分けや書き直しができなければ、上書きしないよう保存を止める（storageLocked）
// - 記録の形式に版（DATA_VERSION）を持たせる。自分より新しい版の形式を見つけたら、読むだけにして
//   上書きしない（更新の途中で古い版の画面が開いたままでも、新しい形式の記録を壊さないように）
// - 形式を変える更新では、変換の前に元のデータを取っておいてから変換する（upgradeData）

// ----- キー（すべて KEY_PREFIX で始める。「すべて削除」はこの前置きで消す） -----
const KEY_PREFIX = 'kimochi-diary-';
const STORAGE_KEY = KEY_PREFIX + 'records';                        // 記録
const DATA_VERSION_KEY = KEY_PREFIX + 'data-version';              // 記録の形式の版（無ければ1）
const BROKEN_KEY_PREFIX = KEY_PREFIX + 'broken-';                  // 読めなかった元データの取り分け（後ろに日時の数値）
const BEFORE_UPGRADE_KEY_PREFIX = KEY_PREFIX + 'before-upgrade-v'; // 形式を変える前の記録（後ろに元の版）
const BEFORE_IMPORT_KEY = KEY_PREFIX + 'before-import';            // ファイルを読み込む前の記録（元に戻す用）
const DRAFT_KEY = KEY_PREFIX + 'draft';                            // 記録画面の書きかけ
const LAST_BACKUP_KEY = KEY_PREFIX + 'last-backup';                // 最後に書き出した日時（ISO 形式）
const CALENDAR_KIND_KEY = KEY_PREFIX + 'calendar-view';            // カレンダーに表示するもの（'mood' か 'condition'）

// ----- 形式の版 -----
// DATA_VERSION：記録の形式の版。書き出すファイルの版（version）も同じ値を使う。
//   項目を消す・意味を変える・睡眠1件の中に項目を足すときは上げ、MIGRATIONS に「1つ前の版 → その版」の
//   変換を足す。変換は、二度かけても同じ結果になるように書く（途中で止まってやり直すことがあるため）。
//   記録そのものに項目を足すだけなら上げない（版2からは、知らない項目だけの日も残すため）
// 版2：記録の項目をすべて任意にした（気分・体調が無い日も正常な記録）。記録の中身は変えない。
//   版1の画面は、気分・体調が無い日を「読めない記録」として外してしまうため、版を上げて書き戻させない
const DATA_VERSION = 2;
const MIGRATIONS = {
  2: (records) => records,
};

// ----- 安全な読み書き -----
// localStorage は、容量不足やプライベートブラウズなどで例外を投げることがある。ここで受け止める
function readItem(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

// 書けなければ false
function writeItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeItem(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // 消せなくても続ける（呼び出し元で残りを数えるものもある）
  }
}

// prefix で始まるキー（古い順＝名前順）
function listKeys(prefix) {
  try {
    return Object.keys(localStorage).filter((k) => k.startsWith(prefix)).sort();
  } catch {
    return [];
  }
}

// JSON として読めなければ undefined
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// 記録の写し（呼び出し元が書き換えても、控えや保存データが変わらないように）。
// structuredClone は iOS 15.4 より前に無いので、JSON で写す（記録は JSON から作ったものなので同じ結果になる）
function copyRecords(records) {
  return JSON.parse(JSON.stringify(records));
}

// ----- データの検査 -----
// localStorage や読み込んだファイルの中身は、形が崩れていることがある（手で編集した・壊れた など）。
// 画面が使う前に必ずここを通して正しい形に直し、直せない記録は捨てる

// 1日分の記録を正しい形に直す。入れ物がオブジェクトでなければ null。
// 知っている項目（RECORD_ITEMS）は項目ごとに検査する（項目どうしは独立していて、どれも任意）
// - 未入力の項目はキーを置かない（sleeps: [] や memo: '' も置かない）
// - 異常値の項目はその項目だけ外し、ほかの項目は残す。内容が減ったら lost: true（呼び出し側で元を取り分ける）
// 知らない項目（将来増える項目など）と管理用の情報は、消さずにそのまま残す
function normalizeRecord(r) {
  if (!isPlainObject(r)) return null;
  const entries = [];
  let lost = false;
  for (const [key, value] of Object.entries(r)) {
    if (!isRecordItemKey(key)) {
      entries.push([key, value]);
      continue;
    }
    const result = RECORD_ITEMS[key].normalize(value);
    if (result.invalid || result.lost) lost = true;
    if ('value' in result) entries.push([key, result.value]);
  }
  // Object.fromEntries で作る。record[key] = value で入れると、"__proto__" という名前の項目は
  // 項目として入らず（オブジェクトのしくみの方が変わり）、知らない項目が黙って消えるため
  return { record: Object.fromEntries(entries), lost };
}

// 記録全体を検査する。入れ物がオブジェクトでなければ null。
// 日付キーが正しく、中身を直せた記録だけを records に残す。
// - 捨てた件数を dropped（元を取り分ける）、残したが一部が減った件数を changed で返す
// - キーが1つも残らない日は除く。もとから空（{} や、未入力の項目だけ）なら情報が無いので数えない。
//   異常値を外して空になったなら dropped に数える
// - 管理用の情報だけの日・空の知らない項目だけの日は、「記録あり」ではない（hasAnyEntry が false）が、消さずに残す
//   （将来の同期などで使う情報を壊さないため。画面は hasAnyEntry で判断する）
// maxKey を渡すと、それより後の日付も除き、その件数を future で返す（ファイルの読み込みで未来の日を弾く）
function normalizeRecords(data, { maxKey } = {}) {
  if (!isPlainObject(data)) return null;
  const records = {};
  let dropped = 0;
  let changed = 0;
  let future = 0;
  for (const [key, r] of Object.entries(data)) {
    if (maxKey && isDateKey(key) && key > maxKey) {
      future++;
      continue;
    }
    const result = isDateKey(key) && key >= MIN_DATE_KEY ? normalizeRecord(r) : null;
    if (!result || (result.lost && Object.keys(result.record).length === 0)) {
      dropped++;
      continue;
    }
    if (Object.keys(result.record).length === 0) continue;
    records[key] = result.record;
    if (result.lost) changed++;
  }
  return { records, dropped, changed, future };
}

// 版 from の形式の記録を、版 to の形式に順に変換する（変換が無ければそのまま返す）。
// 変換できなければ例外を投げる。migrations はテストで差し替える
function migrateRecords(data, from, to = DATA_VERSION, migrations = MIGRATIONS) {
  let converted = data;
  for (let v = from + 1; v <= to; v++) converted = migrations[v](converted);
  return converted;
}

// ----- 記録の読み書き -----
// records は { "2026-09-13": { mood, condition, sleeps: [{ start, end }], memo, effort }, ... } の形。
// 項目はどれも任意で、未入力の項目はキーを置かない（知らない項目・管理用の情報が入っていることもある）
let storageNotice = '';      // 読み込みで見つかった問題（起動時に main.js がお知らせで出す）
let storageLocked = false;   // 上書きしないよう保存を止めているか
let storageLockReason = '';  // 'broken'（壊れていて取り分けられない）／'rewrite'（取り分けたが書き直せない）／'newer'（新しい版の形式）／'upgrade'（形式を新しくする前の控えを取れない）
let recordsCache = null;     // { raw, version, records }：直近に検査した結果。中身も版も同じなら検査をくり返さない

const LOCK_NOTICES = {
  newer: '新しい版のアプリで保存した記録があります。上書きしないよう保存を止めています。アプリを上にスワイプして閉じてから、開き直してください（アイコンは削除しないでください）',
  broken: '保存データを読み込めません。上書きしないよう保存を止めています（設定の「データの削除」）',
  rewrite: '保存データの一部が読めず、直して保存し直す空きがないため、保存を止めています（設定の「データの削除」）',
  upgrade: '記録の形式を新しくする前の控えを保存する空きがないため、保存を止めています。記録は消えていません。設定の「バックアップ」の「書き出す」で記録を保存してください',
};

function lockStorage(reason) {
  storageLocked = true;
  storageLockReason = reason;
  storageNotice = LOCK_NOTICES[reason];
}

function unlockStorage() {
  storageLocked = false;
  storageLockReason = '';
}

// 保存されている形式の版。版を記録する前のデータ（キーが無い）は 1。
// 読めない値は「新しい版」とみなす（分からないものは書き換えない）
function storedDataVersion() {
  const raw = readItem(DATA_VERSION_KEY);
  if (raw === null) return 1;
  const v = Number(raw);
  return Number.isInteger(v) && v >= 1 ? v : Infinity;
}

// 画面に渡す記録（写し）
function loadRecords() {
  const raw = readItem(STORAGE_KEY);
  const cached = recordsCache;
  if (!storageLocked && cached && cached.raw === raw && cached.version === readItem(DATA_VERSION_KEY)) {
    return copyRecords(cached.records);
  }
  return copyRecords(readRecords(raw));
}

// 検査を通した記録を、元の文字列・版と一緒に控えておく
function cacheRecords(raw, records) {
  recordsCache = { raw, version: readItem(DATA_VERSION_KEY), records };
  return records;
}

// 保存データを読んで検査し、必要なら取り分けてから直して保存し直す。
// 版が変わったときの読み直しは1回だけ（canRetry）。書いた版を読み返せない・読むたびに版が変わる保存領域でも、
// 読み直しが終わらずに止まる（起動できなくなる）ことがないように、2回目は読むだけにして保存を止める
function readRecords(raw, canRetry = true) {
  const version = storedDataVersion();
  if (version > DATA_VERSION) {
    lockStorage('newer'); // 読むだけ。直しも保存もしない
    return normalizeRecords(parseJson(raw))?.records ?? {};
  }
  // 記録が無ければ、変換も版の書き込みもしない（すべて削除の直後に、版だけが残らないように。版は最初の保存で書く）
  if (raw === null) {
    unlockStorage();
    return cacheRecords(null, {});
  }
  if (version < DATA_VERSION) {
    // 変換できたら読み直す。できなければ保存を止めたまま、元の記録を読むだけにして見せる。
    // 読み直しでもまだ古い版なら、書いた版が残っていない。変換をくり返さずに止める
    if (!canRetry) lockStorage('broken');
    else if (upgradeData(raw, version)) return readRecords(readItem(STORAGE_KEY), false);
    return normalizeRecords(parseJson(raw))?.records ?? {};
  }

  const result = normalizeRecords(parseJson(raw));
  const records = result?.records ?? {};
  if (result && result.dropped === 0 && result.changed === 0) {
    unlockStorage();
    return cacheRecords(raw, records);
  }

  // 壊れている・直せない記録が混ざっている。元の文字列を別のキーに取り分けてから、
  // 読めた分だけで保存し直す。こうすると、次に保存しても元のデータは消えない。
  // 同じ中身をすでに取り分けてあれば、もう一度は取り分けない（開き直すたびに増えないように）
  // 書き直す直前にも版を確かめる。読んでから書くまでの間に、別に開いた新しい版のアプリが形式を変えていたら、読み直す
  if (storedDataVersion() !== version) {
    if (canRetry) return readRecords(readItem(STORAGE_KEY), false);
    lockStorage('broken'); // 読み直しても版が変わる。書き直さずに止める
    return records;
  }
  if (!isStashed(raw) && !writeItem(BROKEN_KEY_PREFIX + Date.now(), raw)) {
    lockStorage('broken');
    return records;
  }
  const fixed = JSON.stringify(records);
  if (!writeItem(STORAGE_KEY, fixed)) {
    lockStorage('rewrite');
    return records;
  }
  unlockStorage();
  storageNotice = `${brokenReason(result)}ため、元のデータを取り分けました（設定の「データの削除」）`;
  return cacheRecords(fixed, records);
}

// 「読めない記録が2件、一部が読めない記録が1件あった」のような、取り分けた理由
function brokenReason(result) {
  if (!result) return '保存データが壊れていた';
  const parts = [];
  if (result.dropped) parts.push(`読めない記録が${result.dropped}件`);
  if (result.changed) parts.push(`一部が読めない記録が${result.changed}件`);
  return `${parts.join('、')}あった`;
}

// 古い版の形式の記録を、版 to の形式に変換する。成功したら true。失敗したら保存を止めて false。
// 何度やり直しても記録を壊さないように、次の順で行う
// 1. 変換の前に、元の文字列を取っておく。取っておけなければ、記録にも版にも触らずに止める（'upgrade'）。
//    すでに取ってあれば上書きしない（途中で止まってやり直したときに、変換済みの値で元を上書きしないため）
// 2. 変換する。中身が変わらなければ記録は書き直さない（書き直しの途中で止まる機会を作らない）
// 3. 版を書く。書けなかったら、記録を元の文字列に戻す（次に読んだときに二重に変換しないため）
function upgradeData(raw, from, to = DATA_VERSION, migrations = MIGRATIONS) {
  const failed = (reason) => {
    lockStorage(reason);
    return false;
  };
  if (raw !== null) {
    const keepKey = BEFORE_UPGRADE_KEY_PREFIX + from;
    if (readItem(keepKey) === null && !writeItem(keepKey, raw)) return failed('upgrade');
  }
  const data = parseJson(raw);
  if (data && typeof data === 'object') {
    let converted;
    try {
      converted = migrateRecords(data, from, to, migrations);
    } catch {
      return failed('broken');
    }
    const text = JSON.stringify(converted);
    const rewrite = text !== JSON.stringify(data);
    if (rewrite && !writeItem(STORAGE_KEY, text)) return failed('broken');
    if (!writeItem(DATA_VERSION_KEY, String(to))) {
      if (rewrite) writeItem(STORAGE_KEY, raw);
      return failed('broken');
    }
    return true;
  }
  // 記録が無い・壊れている場合は変換できないので、版だけ上げる（壊れた分は通常の検査で取り分ける）
  return writeItem(DATA_VERSION_KEY, String(to)) || failed('broken');
}

function saveRecords(records) {
  // 保存のたびに版を確かめる。開いている間に新しい版のアプリが形式を変えていたら、上書きしない
  if (storedDataVersion() > DATA_VERSION) lockStorage('newer');
  if (storageLocked) return false;
  const raw = JSON.stringify(records);
  // 版は記録より先に書く（記録だけ新しい形式で、版が古いままになると、古い版の画面が書き戻してしまうため）。
  // 版が古いのは、記録が無い状態（すべて削除の後など）から保存するとき。古い形式の記録があれば読み込み時に変換済み
  if (storedDataVersion() < DATA_VERSION && !writeItem(DATA_VERSION_KEY, String(DATA_VERSION))) return false;
  if (!writeItem(STORAGE_KEY, raw)) return false;
  // 控えは必ず検査済みの値にする。検査で変わる値だったら控えを捨て、次に読むときに検査する
  const checked = normalizeRecords(records);
  if (checked && checked.dropped === 0 && checked.changed === 0) cacheRecords(raw, checked.records);
  else recordsCache = null;
  return true;
}

// 保存に失敗したときに画面に出す文
function saveErrorMessage() {
  if (storageLockReason === 'newer' || storageLockReason === 'upgrade') return LOCK_NOTICES[storageLockReason];
  if (storageLocked) return '保存データを読み込めないため、上書きしないよう保存を止めています（設定の「データの削除」）';
  return '保存できませんでした。端末の保存領域がいっぱいの可能性があります';
}

// ----- 取り分けたデータ -----
// 取り分けた壊れたデータのキー（古い順）
function listBrokenKeys() {
  return listKeys(BROKEN_KEY_PREFIX);
}

function isStashed(raw) {
  return listBrokenKeys().some((key) => readItem(key) === raw);
}

// 書き出す用に、取り分けたデータ（形式を変える前の記録も）をまとめる。
// 保存を止めている間は、読めない保存データそのものも入れる
function collectStash() {
  const items = {};
  for (const key of [...listBrokenKeys(), ...listKeys(BEFORE_UPGRADE_KEY_PREFIX)]) {
    const value = readItem(key);
    if (value !== null) items[key] = value;
  }
  if (storageLocked) items[STORAGE_KEY] = readItem(STORAGE_KEY);
  return items;
}

// まだ壊れていれば、次に読んだときにもう一度取り分ける
function removeBrokenData() {
  for (const key of listBrokenKeys()) removeItem(key);
}

// このアプリのデータをすべて消す。消せずに残ったキーの数を返す
function removeAllData() {
  for (const key of listKeys(KEY_PREFIX)) {
    if (key !== DATA_VERSION_KEY) removeItem(key);
  }
  // 形式の版は、記録を消せたときだけ消す（版2の記録が版なしで残ると、開いたままの版1の画面が
  // 古い形式として検査し、気分の無い日などを「読めない記録」として外して書き直してしまうため）
  if (readItem(STORAGE_KEY) === null) removeItem(DATA_VERSION_KEY);
  unlockStorage();
  storageNotice = '';
  recordsCache = null;
  return listKeys(KEY_PREFIX).length;
}

// ----- 書きかけ -----
function saveDraft(draft) {
  writeItem(DRAFT_KEY, JSON.stringify(draft)); // 書けなくても入力は続けられる
}

function clearDraft() {
  removeItem(DRAFT_KEY);
}

// 退避した書きかけを読む。無い・形が崩れている・記録できない日付なら null
function loadDraft() {
  const d = parseJson(readItem(DRAFT_KEY));
  if (!d || typeof d !== 'object' || !isRecordableDate(d.date)) return null;
  const toTime = (v) => (TIME_PATTERN.test(v) ? v : '');
  return {
    date: d.date,
    mood: toScore(d.mood),
    condition: toScore(d.condition),
    sleeps: (Array.isArray(d.sleeps) ? d.sleeps : []).slice(0, MAX_SLEEPS)
      .map((s) => ({ start: toTime(s?.start), end: toTime(s?.end) })),
    memo: typeof d.memo === 'string' ? truncateText(d.memo, MEMO_MAX) : '',
    effort: typeof d.effort === 'string' ? truncateText(d.effort, EFFORT_MAX) : '',
  };
}

// ----- 表示の設定 -----
// カレンダーに表示するもの。無い・読めなければ気分（'mood'）
function loadCalendarKind() {
  return readItem(CALENDAR_KIND_KEY) === 'condition' ? 'condition' : 'mood';
}

function saveCalendarKind(kind) {
  writeItem(CALENDAR_KIND_KEY, kind); // 覚えられなくても、表示の切り替えはできる
}

// ----- バックアップ -----
function makeBackup(records) {
  return { app: 'kimochi-diary', version: DATA_VERSION, exportedAt: new Date().toISOString(), records };
}

// バックアップ（書き出した形式）の記録を、今の形式にして返す。版の無いファイルは版1とみなす。
// 新しい版・変換できないときは { error }
function recordsFromBackup(data) {
  const version = data.version ?? 1;
  if (!Number.isInteger(version) || version < 1) return { error: '対応していない形式のファイルのため、読み込めません', unreadable: true };
  if (version > DATA_VERSION) return { error: '新しい版のアプリで書き出したファイルのため、読み込めません' };
  try {
    return { records: migrateRecords(data.records, version) };
  } catch {
    return { error: '古い形式のファイルを、今の形式に直せませんでした', unreadable: true };
  }
}

// 前回書き出した日時。無ければ null
function readLastBackup() {
  const iso = readItem(LAST_BACKUP_KEY);
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

function markBackedUp() {
  writeItem(LAST_BACKUP_KEY, new Date().toISOString()); // 日時を記録できなくても、書き出し自体は済んでいる
}

// 読み込むファイルの入れ子の深さの上限（ファイルの一番外を1段と数える）。記録の形は数段しか使わない。
// これより深いファイルは読み込まない（深すぎるデータを入れると、書き出しの JSON を作る処理が止まり、以後書き出せなくなるため）
const MAX_IMPORT_DEPTH = 100;

// 入れ子の深さが limit を超えるか。深いデータで関数の呼び出しがあふれないよう、再帰を使わずに調べる
function isTooDeep(value, limit) {
  const stack = [[value, 1]];
  while (stack.length > 0) {
    const [v, depth] = stack.pop();
    if (v === null || typeof v !== 'object') continue;
    if (depth > limit) return true;
    for (const child of Object.values(v)) stack.push([child, depth + 1]);
  }
  return false;
}

// バックアップのファイルの中身（文字列）を検査する。
// 読めなければ { error }、読めれば { records, count（記録ありの日数）, dropped, changed, future }。
// unreadable: true は「このアプリのファイルとして読めない」（壊れている・書き換えられている など）。
// error の文は、原因を調べるための詳しい理由。画面には出さず、利用者には分かる言葉でまとめて知らせる（settings.js）
function parseBackupText(text) {
  const data = parseJson(text);
  if (data === undefined) return { error: 'JSON ファイルとして読めませんでした', unreadable: true };
  if (isTooDeep(data, MAX_IMPORT_DEPTH)) return { error: 'ファイルの中のデータの入れ子が深すぎるため、読み込めません', unreadable: true };
  // 書き出した形式 { app, version, records } と、記録だけの形式（版1とみなす）の両方を受け付ける
  let source = data;
  if (data?.app === 'kimochi-diary') {
    const converted = recordsFromBackup(data);
    if (converted.error) return converted;
    source = converted.records;
  }
  // 中身は、起動時の読み込みと同じ normalizeRecords() で検査する。今日より後の日付は除く。
  // 件数は「記録あり」の日だけを数える（管理用の情報だけの日などは、入れはするが記録として数えない。
  // 数えると、記録の無いファイルで今の記録をまるごと置き換えてしまうため）
  const result = normalizeRecords(source, { maxKey: toDateKey(new Date()) });
  const count = result ? Object.values(result.records).filter(hasAnyEntry).length : 0;
  if (count === 0) return { error: 'このアプリの記録が見つかりませんでした', unreadable: true };
  return { ...result, count };
}

// 記録をまるごと置き換える（ファイルの読み込み）。置き換える前の記録を取っておく（元に戻す用。直前の1回分）。
// 結果は 'ok'／'no-space'（取っておけなかった）／'failed'（保存できなかった）
function replaceRecords(records) {
  const previous = readItem(BEFORE_IMPORT_KEY); // 前の読み込みで取っておいた記録（まだ元に戻せる）
  if (!writeItem(BEFORE_IMPORT_KEY, JSON.stringify(makeBackup(loadRecords())))) return 'no-space';
  if (!saveRecords(records)) {
    // 置き換えていないので、今回取っておいた分は要らない。前の読み込みの「元に戻す」は、消さずに前の中身へ戻す
    if (previous === null || !writeItem(BEFORE_IMPORT_KEY, previous)) removeItem(BEFORE_IMPORT_KEY);
    return 'failed';
  }
  return 'ok';
}

// 読み込む前に取っておいた記録（今の形式にしたもの）。無い・読めなければ null
function readBeforeImport() {
  const data = parseJson(readItem(BEFORE_IMPORT_KEY));
  if (!data || typeof data !== 'object') return null;
  const converted = recordsFromBackup(data);
  const result = converted.error ? null : normalizeRecords(converted.records);
  if (!result) return null;
  const savedAt = new Date(data.exportedAt);
  return { records: result.records, savedAt: Number.isNaN(savedAt.getTime()) ? null : savedAt };
}

function clearBeforeImport() {
  removeItem(BEFORE_IMPORT_KEY);
}
