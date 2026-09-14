// ===== 共通部品：定数・選択肢の定義・日付と睡眠の計算・文字の整形 =====
// 画面（DOM）にも保存（localStorage）にも依存しない関数だけを置く。保存まわりは storage.js

const MIN_DATE_KEY = '2000-01-01'; // 記録できる一番古い日
const MIN_YEAR = Number(MIN_DATE_KEY.slice(0, 4)); // カレンダー・グラフで戻れる一番古い年
const MAX_SLEEPS = 3;              // 1日に登録できる睡眠の最大件数
// 文字数の上限。数え方は UTF-16 の単位（入力欄の maxlength と同じ。絵文字の多くは2と数える）
const MEMO_MAX = 100;              // ひとことメモ（index.html の maxlength と同じ値）
const EFFORT_MAX = 200;            // 頑張ったこと（同上）
const NIGHT_END_HOUR = 4;          // 0時〜4時前に開いたら、前日を「記録する日」の初期値にする
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/; // "00:00"〜"23:59"

// 選択肢の定義。記録画面のボタン・カレンダー・グラフはすべてここを参照する
// cheers（気分）と cares（体調が悪い日）は、保存したときに返す言葉（共感）。毎回同じにならないよう数種類ずつ
const MOODS = [
  { value: 1, icon: '😢', label: 'つらい',
    cheers: ['今日はゆっくり休んでね', '記録してくれてありがとう', 'つらい気持ち、ここに置いていってね', '今夜は自分をいたわってね'] },
  { value: 2, icon: '😕', label: 'いまいち',
    cheers: ['おつかれさま。自分をいたわってね', 'そんな日もあるよね', '記録してくれてありがとう', '温かくして休んでね'] },
  { value: 3, icon: '😐', label: 'ふつう',
    cheers: ['今日もおつかれさま', 'いつもの一日も、大切な一日', 'ほっと一息ついてね', '今日も記録できたね'] },
  { value: 4, icon: '😊', label: 'いい感じ',
    cheers: ['いい一日でしたね', 'その調子！', 'いいことがあったのかな', '明日もいい日になりますように'] },
  { value: 5, icon: '🥳', label: '最高',
    cheers: ['最高の一日でしたね！', 'うれしい気持ち、ここに残せたね', 'すてきな一日でしたね！', 'この気分、覚えておこうね'] },
];

const CONDITIONS = [
  { value: 1, icon: '🤒', label: '悪い',
    cares: ['体調が悪い中、おつかれさま。ゆっくり休んでね', '無理しないでね。記録してくれてありがとう', '今日は早めに休んでね'] },
  { value: 2, icon: '😣', label: 'やや悪い',
    cares: ['無理せず、体をいたわってね', '温かくして過ごしてね', '少しでも休めますように'] },
  { value: 3, icon: '😐', label: 'ふつう' },
  { value: 4, icon: '🙂', label: '良い' },
  { value: 5, icon: '💪', label: '絶好調' },
];

// 保存したときに返す言葉。体調が悪い日は体調を気づかい、それ以外は気分に寄り添う。
// 前回と同じ言葉が続かないように選ぶ
let lastCheerText = '';
function cheerFor(mood, condition) {
  const cond = CONDITIONS[condition - 1];
  const source = cond.cares ? cond : MOODS[mood - 1];
  const list = cond.cares ?? source.cheers;
  const choices = list.filter((t) => t !== lastCheerText);
  lastCheerText = choices[Math.floor(Math.random() * choices.length)];
  return { icon: source.icon, text: lastCheerText };
}

// 1〜5 の整数に直す（"3" のような文字も数にする）。直せなければ null
function toScore(v) {
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
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

// 記録できる日か（2000年1月1日〜今日の、実在する日）
function isRecordableDate(key) {
  return isDateKey(key) && key >= MIN_DATE_KEY && key <= toDateKey(new Date());
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
// 文字列を max 単位（UTF-16）までに切る。絵文字など2単位で1文字のもの（サロゲートペア）を途中で割らない
function truncateText(str, max) {
  if (str.length <= max) return str;
  const last = str.charCodeAt(max - 1);
  return str.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max);
}

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
