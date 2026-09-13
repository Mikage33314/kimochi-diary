// ===== 共通部品：設定・データの検査と読み書き・日付と睡眠の計算 =====
// 画面（DOM）に依存しない関数だけを置き、各画面から使う

// localStorage のキーはすべて KEY_PREFIX で始める（「すべて削除」はこの前置きで消す）
const KEY_PREFIX = 'kimochi-diary-';
const STORAGE_KEY = KEY_PREFIX + 'records';
const BROKEN_KEY_PREFIX = KEY_PREFIX + 'broken-'; // 読めなかった元データの取り分け先（後ろに日時の数値）
const BEFORE_IMPORT_KEY = KEY_PREFIX + 'before-import'; // 読み込む前の記録（元に戻す用）
const DRAFT_KEY = KEY_PREFIX + 'draft'; // 記録画面の書きかけ
const BACKUP_VERSION = 1; // バックアップ形式の版。これより新しい版のファイルは読み込まない
const MIN_DATE_KEY = '2000-01-01'; // 記録できる一番古い日
const MAX_SLEEPS = 3; // 1日に登録できる睡眠の最大件数
const NIGHT_END_HOUR = 4; // 0時〜4時前に開いたら、前日を「記録する日」の初期値にする
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

// 選択肢の定義。記録画面のボタン・カレンダー・グラフはすべてここを参照する
// cheer（気分）と care（体調が悪い日）は、保存したときに返す言葉（共感）
const MOODS = [
  { value: 1, icon: '😢', label: 'つらい', cheer: '今日はゆっくり休んでね' },
  { value: 2, icon: '😕', label: 'いまいち', cheer: 'おつかれさま。自分をいたわってね' },
  { value: 3, icon: '😐', label: 'ふつう', cheer: '今日もおつかれさま' },
  { value: 4, icon: '😊', label: 'いい感じ', cheer: 'いい一日でしたね' },
  { value: 5, icon: '🥳', label: '最高', cheer: '最高の一日でしたね！' },
];

const CONDITIONS = [
  { value: 1, icon: '🤒', label: '悪い', care: '体調が悪い中、おつかれさま。ゆっくり休んでね' },
  { value: 2, icon: '😣', label: 'やや悪い', care: '無理せず、体をいたわってね' },
  { value: 3, icon: '😐', label: 'ふつう' },
  { value: 4, icon: '🙂', label: '良い' },
  { value: 5, icon: '💪', label: '絶好調' },
];

// 保存したときに返す言葉。体調が悪い日は体調を気づかい、それ以外は気分に寄り添う
function cheerFor(mood, condition) {
  const cond = CONDITIONS[condition - 1];
  if (cond.care) return { icon: cond.icon, text: cond.care };
  const m = MOODS[mood - 1];
  return { icon: m.icon, text: m.cheer };
}

// ----- データの検査 -----
// localStorage や読み込んだファイルの中身は、形が崩れていることがある（手で編集した・壊れた など）。
// 画面が使う前に必ずここを通して正しい形に直し、直せない記録は捨てる
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/; // "00:00"〜"23:59"

// 1〜5 の整数に直す（"3" のような文字も数にする）。直せなければ null
function toScore(v) {
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

// 1日分の記録を正しい形に直す。気分・体調が無い（直せない）記録は null。
// 知らない項目（将来増える項目など）は、...r で消さずにそのまま残す
function normalizeRecord(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const mood = toScore(r.mood);
  const condition = toScore(r.condition);
  if (mood === null || condition === null) return null;

  const sleeps = (Array.isArray(r.sleeps) ? r.sleeps : [])
    .filter((s) => s && TIME_PATTERN.test(s.start) && TIME_PATTERN.test(s.end) && s.start !== s.end)
    .slice(0, MAX_SLEEPS)
    .map((s) => ({ ...s }));

  return {
    ...r,
    mood,
    condition,
    sleeps,
    memo: typeof r.memo === 'string' ? r.memo.slice(0, 100) : '',
    effort: typeof r.effort === 'string' ? r.effort.slice(0, 200) : '',
  };
}

// 直したときに内容が減ったか（捨てた睡眠・切った文字・読めない値がある）。
// "3" → 3 や、無い memo → '' のように、情報が減らない直し方は含めない
function lostPart(r, rec) {
  const sleeps = r.sleeps ?? [];
  return !Array.isArray(sleeps) || sleeps.length !== rec.sleeps.length
    || (r.memo != null && r.memo !== rec.memo)
    || (r.effort != null && r.effort !== rec.effort);
}

// 記録全体を検査する。入れ物がオブジェクトでなければ null。
// 日付キーが正しく、中身を直せた記録だけを records に残す。
// 捨てた件数を dropped、残したが一部が減った件数を changed で返す。
// maxKey を渡すと、それより後の日付も捨てる（ファイルの読み込みで未来の日を弾く）
function normalizeRecords(data, { maxKey } = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const records = {};
  let dropped = 0;
  let changed = 0;
  for (const [key, r] of Object.entries(data)) {
    const keyOk = isDateKey(key) && key >= MIN_DATE_KEY && (!maxKey || key <= maxKey);
    const rec = keyOk ? normalizeRecord(r) : null;
    if (!rec) {
      dropped++;
      continue;
    }
    records[key] = rec;
    if (lostPart(r, rec)) changed++;
  }
  return { records, dropped, changed };
}

// ----- データの読み書き -----
// records は { "2026-09-13": { mood, condition, sleeps: [{ start, end }], memo, effort }, ... } の形
let storageNotice = '';    // 読み込みで見つかった問題（起動時に main.js がお知らせで出す）
let storageLocked = false; // 壊れたデータを取り分けられなかったとき、上書きしないよう保存を止める

function loadRecords() {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return {}; // 保存領域そのものが使えない環境
  }
  if (raw === null) return {};

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = undefined;
  }
  const result = normalizeRecords(data);
  if (result && result.dropped === 0 && result.changed === 0) {
    storageLocked = false;
    return result.records;
  }

  // 壊れている・直せない記録が混ざっている。元の文字列を別のキーに取り分けてから、
  // 読めた分だけで保存し直す。こうすると、次に保存しても元のデータは消えない
  const records = result ? result.records : {};
  try {
    localStorage.setItem(BROKEN_KEY_PREFIX + Date.now(), raw);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    storageLocked = false; // 空きができて取り分けられたら、保存を再開する
    storageNotice = `${brokenReason(result)}ため、元のデータを取り分けました（設定画面）`;
  } catch {
    storageLocked = true;
    storageNotice = '保存データを読み込めません。上書きしないよう保存を止めています（設定画面）';
  }
  return records;
}

// 「読めない記録が2件、一部が読めない記録が1件あった」のような、取り分けた理由
function brokenReason(result) {
  if (!result) return '保存データが壊れていた';
  const parts = [];
  if (result.dropped) parts.push(`読めない記録が${result.dropped}件`);
  if (result.changed) parts.push(`一部が読めない記録が${result.changed}件`);
  return `${parts.join('、')}あった`;
}

// 保存データの元の文字列（保存を止めているときに、そのまま書き出す用）
function readRawRecords() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

// localStorage に書く。空き容量不足などで書けなければ false
function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

// このアプリのデータをすべて消す。消せずに残ったキーの数を返す
function removeAllData() {
  let keys = [];
  try {
    keys = Object.keys(localStorage).filter((k) => k.startsWith(KEY_PREFIX));
  } catch {
    return 0;
  }
  for (const key of keys) {
    try {
      localStorage.removeItem(key);
    } catch {
      // 消せないものは残る（呼び出し元で件数を知らせる）
    }
  }
  storageLocked = false;
  storageNotice = '';
  try {
    return Object.keys(localStorage).filter((k) => k.startsWith(KEY_PREFIX)).length;
  } catch {
    return 0;
  }
}

function saveRecords(records) {
  if (storageLocked) return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    return true;
  } catch {
    return false;
  }
}

// 保存に失敗したときに画面に出す文
function saveErrorMessage() {
  return storageLocked
    ? '保存データを読み込めないため、上書きしないよう保存を止めています'
    : '保存できませんでした。端末の保存領域がいっぱいの可能性があります';
}

// 取り分けた壊れたデータのキー（古い順）
function listBrokenKeys() {
  try {
    return Object.keys(localStorage).filter((k) => k.startsWith(BROKEN_KEY_PREFIX)).sort();
  } catch {
    return [];
  }
}

// ----- 日付・時刻 -----
// toISOString() は UTC 基準なので、日本時間の朝9時前だと「前日」になってしまう。
// ローカル時刻の年月日から自分で組み立てる
function toDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// "2026-09-13" → その日の Date（ローカル時刻の0時）
function fromDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// "YYYY-MM-DD" の形で、実在する日付か（"2026-02-30" などは不可）
function isDateKey(key) {
  return /^\d{4}-\d{2}-\d{2}$/.test(key) && toDateKey(fromDateKey(key)) === key;
}

// 日付キーを delta 日ずらす。new Date は日のはみ出し（0日や32日）を前月・翌月に直してくれる
function shiftDateKey(key, delta) {
  const d = fromDateKey(key);
  return toDateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta));
}

// 記録する日の初期値。0〜4時は前日（寝る前に記録していて0時を過ぎた、とみなす）
function defaultRecordDate(now = new Date()) {
  const today = toDateKey(now);
  return now.getHours() < NIGHT_END_HOUR ? shiftDateKey(today, -1) : today;
}

// "2026-09-13" → "9月13日（日）"
function formatDateJa(key) {
  const d = fromDateKey(key);
  return `${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）`;
}

// "07:30" → 450（0時からの分数）
function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// 450 → "07:30"
function fromMinutes(min) {
  const h = String(Math.floor(min / 60)).padStart(2, '0');
  const m = String(min % 60).padStart(2, '0');
  return `${h}:${m}`;
}

// 年・月（0〜11）を delta か月ずらす。new Date は月のはみ出し（-1 や 12）を前年・翌年に直してくれる
function shiftMonth(year, month, delta) {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

// 今月、またはそれより先の月か。「年×12＋月」にすると年またぎも1つの数で比べられる
function isCurrentOrFutureMonth(year, month) {
  const now = new Date();
  return year * 12 + month >= now.getFullYear() * 12 + now.getMonth();
}

// ----- 睡眠の計算（時間は保存せず、毎回ここで計算する） -----
// 23:30〜7:00 のように日付をまたぐと「終了 − 開始」がマイナスになる。
// 1日分（1440分）を足してから 1440 で割った余りを取れば、またいでも正しい長さになる
function sleepHours({ start, end }) {
  return ((toMinutes(end) - toMinutes(start) + 1440) % 1440) / 60;
}

function totalSleepHours(record) {
  return record.sleeps.reduce((sum, s) => sum + sleepHours(s), 0);
}

function isValidSleep({ start, end }) {
  return start !== '' && end !== '' && start !== end;
}

// その日で一番長い睡眠（主な睡眠）。sleeps が1件以上あるときだけ呼ぶ
function mainSleep(record) {
  return record.sleeps.reduce((best, s) => (sleepHours(s) > sleepHours(best) ? s : best));
}

// 就寝時刻の平均。時刻を「時計の文字盤の上の点」として平均する（円周平均）。
// ふつうに平均すると 23:30 と 0:30 が 12:00 になってしまうが、文字盤の上なら真ん中の 0:00 になる。
// 真逆の時刻どうし（0:00 と 12:00 など）は向きが決まらないので null
function averageBedtime(times) {
  if (times.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const t of times) {
    const angle = (toMinutes(t) / 1440) * 2 * Math.PI;
    x += Math.cos(angle);
    y += Math.sin(angle);
  }
  if (Math.hypot(x, y) < 1e-9) return null;
  const angle = (Math.atan2(y, x) + 2 * Math.PI) % (2 * Math.PI);
  return fromMinutes(Math.round((angle / (2 * Math.PI)) * 1440) % 1440);
}

// 時間（小数）→ "7時間20分"。分は四捨五入する。ちょうどなら "7時間"、1時間未満なら "40分"
function formatHours(h) {
  const total = Math.round(h * 60);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes}分`;
  return minutes ? `${hours}時間${minutes}分` : `${hours}時間`;
}

// ----- その他 -----
// 数値の平均。空なら null
function average(nums) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

// 利用者が入力した文字を innerHTML に入れる前に無害化する（< や & を「文字」として表示させる）
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
