// ===== 共通部品：定数・選択肢の定義・日付と睡眠の計算・文字の整形 =====
// 画面（DOM）にも保存（localStorage）にも依存しない関数だけを置く。保存まわりは storage.js

// アプリの Version（設定の「このアプリ」に出す。テストの記録・問い合わせで、どの版かを確かめるため）。
// 記録の形式の版（storage.js の DATA_VERSION）とは別のもの。公開するときに、ユーザーと決めた番号にする
const APP_VERSION = '0.2.1';

const MIN_DATE_KEY = '2000-01-01'; // 記録できる一番古い日
const MIN_YEAR = Number(MIN_DATE_KEY.slice(0, 4)); // カレンダー・グラフで戻れる一番古い年
const MAX_SLEEPS = 3;              // 1日に登録できる睡眠の最大件数
// 文字数の上限。数え方は UTF-16 の単位（入力欄の maxlength と同じ。絵文字の多くは2と数える）
const MEMO_MAX = 100;              // ひとことメモ（index.html の maxlength と同じ値）
const EFFORT_MAX = 200;            // 今日できたこと（同上。保存データのキーは effort のまま）
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
// 気分・体調はどちらも任意。気分が無く、体調も悪くない日（睡眠だけ など）は null（言葉なし）。
// 前回と同じ言葉が続かないように選ぶ
let lastCheerText = '';
function cheerFor(mood, condition) {
  const cond = CONDITIONS[condition - 1]; // 体調が無ければ undefined
  const source = cond?.cares ? cond : MOODS[mood - 1];
  if (!source) return null;
  const list = source.cares ?? source.cheers;
  const choices = list.filter((t) => t !== lastCheerText);
  lastCheerText = choices[Math.floor(Math.random() * choices.length)];
  return { icon: source.icon, text: lastCheerText };
}

// 1〜5 の整数に直す（"3" のような文字も数にする）。直せなければ null
function toScore(v) {
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

// ----- 記録の項目（1日分の記録の中身） -----
// 記録の項目はすべて独立した任意の項目。特定の項目どうしが同時にあることを前提にしない。
// RECORD_ITEMS は、この版のアプリが知っている項目の表。項目を足すときは、ここに1つ足す。
// normalize(value) の結果は次のどれか（保存データの検査・編集の反映・「記録あり」の判定で共通に使う）
// - { value }：正常な値（直した値のこともある）。lost: true なら、直すときに内容が減った（元を取り分ける）
// - { empty: true }：未入力（正常）。キーを置かない
// - { invalid: true }：仕様上ありえない値（異常値）。その項目だけ外し、元を取り分ける
const scoreItem = {
  normalize(v) {
    if (v == null) return { empty: true };
    const n = toScore(v);
    return n === null ? { invalid: true } : { value: n };
  },
  equals: (a, b) => (a ?? null) === (b ?? null),
};

const sleepsItem = {
  normalize(v) {
    if (v == null) return { empty: true };
    if (!Array.isArray(v)) return { invalid: true };
    // 時刻は文字だけを認める（["23:00"] のような配列も、そのままだと正規表現の検査を通ってしまうため）
    const isTime = (t) => typeof t === 'string' && TIME_PATTERN.test(t);
    const kept = v
      .filter((s) => s && isTime(s.start) && isTime(s.end) && s.start !== s.end)
      .slice(0, MAX_SLEEPS)
      .map((s) => ({ ...s }));
    const lost = kept.length !== v.length;
    if (kept.length === 0) return lost ? { invalid: true } : { empty: true };
    return lost ? { value: kept, lost } : { value: kept };
  },
  equals: (a, b) => {
    const x = a ?? [];
    const y = b ?? [];
    return x.length === y.length && x.every((s, i) => s.start === y[i].start && s.end === y[i].end);
  },
};

// メモ・今日できたこと。空白だけの文字は未入力とみなす
const textItem = (max) => ({
  normalize(v) {
    if (v == null) return { empty: true };
    if (typeof v !== 'string') return { invalid: true };
    if (v.trim() === '') return { empty: true };
    const text = truncateText(v, max);
    return text === v ? { value: v } : { value: text, lost: true };
  },
  equals: (a, b) => (a ?? '') === (b ?? ''),
});

const RECORD_ITEMS = {
  mood: scoreItem,
  condition: scoreItem,
  sleeps: sleepsItem,
  memo: textItem(MEMO_MAX),
  effort: textItem(EFFORT_MAX),
};
const RECORD_ITEM_KEYS = Object.keys(RECORD_ITEMS);

// 管理用の情報。これだけがある日を「記録あり」と数えない（今の版は書き込まない）
const RECORD_META_KEYS = ['date', 'id', 'version', 'createdAt', 'updatedAt'];

// RECORD_ITEMS が持つ項目か（"toString" など、オブジェクトが元から持つ名前を項目とみなさない）
function isRecordItemKey(key) {
  return Object.prototype.hasOwnProperty.call(RECORD_ITEMS, key);
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// 知らない項目の値が空か（null・''・[]・{}）
function isBlankValue(v) {
  if (v == null || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  return isPlainObject(v) && Object.keys(v).length === 0;
}

// ユーザーの記録が1つでもあるか。
// 知っている項目は正常な値があるとき、知らない項目（将来の項目）は空でない値があるときに数える。管理用の情報は数えない
function hasAnyEntry(record) {
  if (!isPlainObject(record)) return false;
  return Object.entries(record).some(([key, value]) => {
    if (isRecordItemKey(key)) return 'value' in RECORD_ITEMS[key].normalize(value);
    return !RECORD_META_KEYS.includes(key) && !isBlankValue(value);
  });
}

// その日の睡眠の一覧（無ければ空の配列）
function recordSleeps(record) {
  return Array.isArray(record?.sleeps) ? record.sleeps : [];
}

// 編集した内容を、1日分の記録に反映する。
// - 入れ替えるのは editedKeys（画面に出して編集した項目）だけ。ほかの項目（画面に出していない項目・知らない項目・管理用の情報）は残す
// - input で未入力・異常値の項目は消す（解除した項目の古い値を残さない。異常値のときも前の値に戻さない）。
//   入力の検査は画面側で保存の前に行う
// 結果に記録が1つも無ければ null（呼び出し側でその日を消す）
function applyRecordEdit(prev, input, editedKeys = RECORD_ITEM_KEYS) {
  const next = isPlainObject(prev) ? JSON.parse(JSON.stringify(prev)) : {};
  for (const key of editedKeys) {
    if (!isRecordItemKey(key)) continue;
    const result = RECORD_ITEMS[key].normalize(input?.[key]);
    if ('value' in result) next[key] = result.value;
    else delete next[key];
  }
  return hasAnyEntry(next) ? next : null;
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

// "YYYY-MM-DD" の形の文字で、実在する日付か（"2026-02-30" などは不可）。
// 文字でない値（["2026-09-13"] のような配列）は、正規表現の検査を通ってしまうので先に外す
function isDateKey(key) {
  return typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key) && toDateKey(fromDateKey(key)) === key;
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
  return recordSleeps(record).reduce((sum, s) => sum + sleepHours(s), 0);
}

function isValidSleep({ start, end }) {
  return start !== '' && end !== '' && start !== end;
}

// 睡眠同士で時間が重なっている件の番号（0から）の Set。sleeps は isValidSleep の件だけを渡す。
// 睡眠は目が覚めた日の記録に入るので、寝た日は時刻から決まる：寝た時刻が起きた時刻より遅ければ前日（23:00〜7:00）、
// 早ければ当日（13:00〜14:00）。目が覚めた日の0時を0分とした1本の時間の線に並べて比べる
// （前日22:00〜6:00 と 当日21:00〜23:00 は重ならない）。同じ時間の2件は重なり、ちょうどつながる時間は重ならない
function overlappingSleeps(sleeps) {
  const spans = sleeps.map(({ start, end }) => {
    const s = toMinutes(start);
    const e = toMinutes(end);
    return [s > e ? s - 1440 : s, e];
  });
  const found = new Set();
  spans.forEach(([s1, e1], i) => {
    spans.forEach(([s2, e2], j) => {
      if (i !== j && s1 < e2 && s2 < e1) found.add(i);
    });
  });
  return found;
}

// その日で一番長い睡眠（主な睡眠）。sleeps が1件以上あるときだけ呼ぶ
function mainSleep(record) {
  return recordSleeps(record).reduce((best, s) => (sleepHours(s) > sleepHours(best) ? s : best));
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

// 就寝時刻の中央値。そのまま並べると 23:30 と 0:30 が両端に離れてしまうので、
// 平均の時刻を中心に「前後12時間」の数直線に直してから真ん中を取る（23:30 と 0:30 の真ん中は 0:00）。
// 平均の向きが決まらないとき（真逆の時刻どうし）は 0:00 を中心にする
function medianBedtime(times) {
  if (times.length === 0) return null;
  const center = toMinutes(averageBedtime(times) ?? '00:00');
  const offsets = times.map((t) => ((toMinutes(t) - center + 2160) % 1440) - 720); // 中心から何分ずれているか（-720〜719）
  return fromMinutes((Math.round(center + median(offsets)) % 1440 + 1440) % 1440);
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

// 気分・体調の平均の表示。数値は小数第1位までで、四捨五入せずに切り捨てる（3.45 → "3.4"）。
// 顔は平均を四捨五入して選ぶ（scoreOption）。数値を切り捨てにすると、表示が x.5 になったときに顔が変わるので、
// 「😐 3.5」のように顔と数値が食い違わない。
// 小数の計算の誤差（2.3 が 2.2999… になる）で1つ下にならないよう、わずかに足してから切り捨てる
function formatScore(avg) {
  return (Math.floor(avg * 10 + 1e-9) / 10).toFixed(1);
}

// 平均に近い段階の選択肢（顔と名前）。四捨五入で選ぶ
function scoreOption(avg, options) {
  return options[Math.round(avg) - 1];
}

// 数値の平均。空なら null
function average(nums) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

// 数値の中央値（小さい順に並べたときの真ん中。数が偶数なら、真ん中の2つの平均）。空なら null
function median(nums) {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// 利用者が入力した文字を innerHTML に入れる前に無害化する（< や & を「文字」として表示させる）
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
