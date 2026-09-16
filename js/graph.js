// ===== グラフ画面 =====
const SVG_NS = 'http://www.w3.org/2000/svg';
const statsEl = document.getElementById('stats');
const statsNoteEl = document.getElementById('stats-note');
const moodChartEl = document.getElementById('chart-mood');
const sleepChartEl = document.getElementById('chart-sleep');
const moodChartTitleEl = document.getElementById('chart-mood-title');
const sleepKeyEl = document.getElementById('sleep-key');
const chartNoteEl = document.getElementById('chart-note');
const yearTableEl = document.getElementById('year-table');
const yearTableBody = document.getElementById('year-table-body');
const periodEl = document.getElementById('period');
const graphMonthNavEl = document.getElementById('graph-month-nav');
const graphTitleEl = document.getElementById('graph-title');
const graphPrevBtn = document.getElementById('graph-prev');
const graphNextBtn = document.getElementById('graph-next');
const statKindEl = document.getElementById('stat-kind');

// 表示期間：'week' は今日までの直近7日、'month' は1か月（その月の日数ぶん）、'year' は1年（12か月）
let graphMode = 'week';
// 睡眠・就寝時刻のカードの出し方：'mean'（平均）か 'median'（中央値＝並べたときの真ん中。極端な日に引っぱられにくい）
let statKind = 'mean';
let graphYear = new Date().getFullYear();
let graphMonth = new Date().getMonth(); // 0〜11
// 年ごとの表示で、記録がこれより少ない月は「参考程度に」として目立たせない
// （少ない日数の平均ほど極端な値になり、一番目立つ点が一番あてにならなくなるため）
const FEW_DAYS = 5;

// グラフの座標は viewBox（幅360）の中で考える。実際の表示サイズは CSS で幅100%に伸び縮みする
const CHART_W = 360;
const PAD = { left: 38, right: 10, top: 14, bottom: 26 };

// SVG の要素は createElement ではなく createElementNS（名前空間付き）で作る必要がある
function svgEl(tag, attrs, parent, text) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text != null) el.textContent = text;
  parent.appendChild(el);
  return el;
}

// ----- 表示する期間 -----
// 表示する年・月を「2000年1月〜今月」に収める。年ごとの表示で次の年へ送ると、月だけ今月より先に
// なることがある（例：2025年12月 → 年ごと → 2026年 → 月ごと）。描く前に必ずここで直す
function clampGraphPeriod() {
  const now = new Date();
  const index = Math.min(Math.max(graphYear * 12 + graphMonth, MIN_YEAR * 12), now.getFullYear() * 12 + now.getMonth());
  graphYear = Math.floor(index / 12);
  graphMonth = index % 12;
}

// 日付が変わったとき（main.js から呼ぶ）：今日を含む期間に戻す。表示期間の種類（7日・月・年）はそのまま
function graphToToday() {
  const now = new Date();
  graphYear = now.getFullYear();
  graphMonth = now.getMonth();
}

// 今日を含む直近 n 日の日付キー（古い順）
function recentDateKeys(n) {
  const now = new Date();
  const keys = [];
  for (let i = n - 1; i >= 0; i--) {
    keys.push(toDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)));
  }
  return keys;
}

// 指定した月の全日付キー。1か月の日数は 28〜31日 と月ごとに違うので、
// 「翌月の0日」＝今月の末日 から日数を求めて、その数だけ並べる
function monthDateKeys(year, month) {
  const lastDate = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: lastDate }, (_, i) => toDateKey(new Date(year, month, i + 1)));
}

// 期間平均のカードに使う日付キー（年ごとの表示は、その年の全日）
function graphDateKeys() {
  if (graphMode === 'week') return recentDateKeys(7);
  if (graphMode === 'month') return monthDateKeys(graphYear, graphMonth);
  return Array.from({ length: 12 }, (_, m) => monthDateKeys(graphYear, m)).flat();
}

// ----- グラフの横軸の1つ分（点） -----
// 7日・月ごとの表示は1日が1点、年ごとの表示は1か月が1点。
// mood / condition / sleep は描く値（記録が無ければ null）
function dayPoint(key, r) {
  return { key, mood: r?.mood ?? null, condition: r?.condition ?? null, sleep: recordSleeps(r).length ? totalSleepHours(r) : null };
}

// 1か月分の記録を平均して1点にする。count は記録日数、sleepCount は睡眠を記録した日数。
// 睡眠は、睡眠を記録した日だけで平均する
function monthPoint(year, month, records) {
  const recs = monthDateKeys(year, month).map((k) => records[k]).filter(Boolean);
  const withSleep = recs.filter((r) => recordSleeps(r).length);
  return {
    month,
    count: recs.length,
    sleepCount: withSleep.length,
    mood: average(recs.map((r) => r.mood)),
    condition: average(recs.map((r) => r.condition)),
    sleep: average(withSleep.map((r) => totalSleepHours(r))),
  };
}

// 年ごとの表示で、記録が少ない月か。気分・体調は記録日数、睡眠は睡眠を記録した日数で決める
// （1日1点の表示には日数が無いので、いつも false）
const isFew = (n) => n != null && n > 0 && n < FEW_DAYS;
const isFewDays = (p) => isFew(p.count);
const isFewSleep = (p) => isFew(p.sleepCount);

// i 番目の点の x 座標。各点の「枠」の中央に置くので、棒と折れ線の位置がそろう
function xAt(i, n) {
  const plotW = CHART_W - PAD.left - PAD.right;
  return PAD.left + (i + 0.5) * (plotW / n);
}

// 値 → y 座標の変換関数を作る。SVG は下に行くほど y が大きいので上下を反転させる
function yScale(min, max, height) {
  const plotH = height - PAD.top - PAD.bottom;
  return (v) => PAD.top + (1 - (v - min) / (max - min)) * plotH;
}

// 折れ線を、実線（solid）と点線（dotted）の2本の path に分ける。値のある点どうしを順に結び、
// - 隣どうしで、どちらも少ない月（weak）でなければ実線
// - 記録の無い点をまたぐ・少ない月につながるなら点線（線が途切れて読めなくならず、少ない月を強く見せない）
// 実線は続いている間は L（線を引く）、途切れた後は M（ペンを移動）から描き始める
function seriesPaths(values, weak, xFn, yFn) {
  const pt = (i) => `${xFn(i).toFixed(1)},${yFn(values[i]).toFixed(1)}`;
  let solid = '';
  let dotted = '';
  let prev = -1;   // 1つ前の、値のある点
  let penAt = -1;  // 実線のペンが今いる点
  values.forEach((v, i) => {
    if (v == null) return;
    if (prev >= 0) {
      if (i - prev === 1 && !weak[prev] && !weak[i]) {
        solid += `${penAt === prev ? '' : `M${pt(prev)} `}L${pt(i)} `;
        penAt = i;
      } else {
        dotted += `M${pt(prev)} L${pt(i)} `;
      }
    }
    prev = i;
  });
  return { solid: solid.trim(), dotted: dotted.trim() };
}

// 下の目盛りの文字（null の所は描かない）。数字だけを並べ、単位は左下に1つだけ出す（X_UNITS）。
// 全部に単位を付けると隣と重なり、一部だけに付けると一貫しないため
// - 7日：「9/13」を毎日（単位なし）
// - 月ごと：日にちを 1日・5の倍数・末日 に付ける（末日のすぐ手前の5の倍数＝31日の月の30日 は重なるので省く）
// - 年ごと：1〜12 の月
const X_UNITS = { month: '日', year: '月' };
function xLabels(points) {
  const n = points.length;
  if (graphMode === 'year') return points.map((p) => String(p.month + 1));
  return points.map(({ key }) => {
    const d = fromDateKey(key);
    const day = d.getDate();
    if (graphMode === 'week') return `${d.getMonth() + 1}/${day}`;
    return day === 1 || day === n || (day % 5 === 0 && n - day >= 2) ? String(day) : null;
  });
}

function drawXLabels(svg, points, height) {
  const n = points.length;
  xLabels(points).forEach((label, i) => {
    if (label != null) svgEl('text', { x: xAt(i, n), y: height - 6, 'text-anchor': 'middle', class: 'axis-label' }, svg, label);
  });
  // 単位は、縦軸の文字の列の一番下（横軸の文字と同じ高さ）に置く
  const unit = X_UNITS[graphMode];
  if (unit) svgEl('text', { x: PAD.left - 8, y: height - 6, 'text-anchor': 'end', class: 'axis-label axis-unit' }, svg, unit);
}

function drawEmpty(svg, height) {
  svgEl('text', { x: CHART_W / 2, y: (height - PAD.bottom) / 2 + PAD.top / 2, 'text-anchor': 'middle', class: 'empty-label' },
    svg, 'この期間の記録はありません');
}

// ----- 気分・体調の折れ線 -----
function drawMoodChart(points) {
  const svg = moodChartEl;
  const H = svg.viewBox.baseVal.height; // 高さは HTML の viewBox から読む
  const n = points.length;
  const y = yScale(1, 5, H);
  svg.replaceChildren();
  svg.classList.toggle('is-dense', n > 12); // 月ごと（28〜31点）は線を細くする

  // 横の目盛り線と、左端の顔アイコン
  for (const m of MOODS) {
    svgEl('line', { x1: PAD.left, x2: CHART_W - PAD.right, y1: y(m.value), y2: y(m.value), class: 'grid-line' }, svg);
    svgEl('text', { x: PAD.left - 8, y: y(m.value), 'text-anchor': 'end', 'dominant-baseline': 'central', class: 'axis-icon' },
      svg, m.icon);
  }
  drawXLabels(svg, points, H);

  if (!points.some((p) => p.mood != null)) {
    drawEmpty(svg, H);
    return;
  }

  // 気分は実線と丸、体調は破線と四角。色だけに頼らず、線と点の形でも見分けられるようにする
  const series = [
    { cls: 'series-mood', shape: 'circle', values: points.map((p) => p.mood) },
    { cls: 'series-condition', shape: 'square', values: points.map((p) => p.condition) },
  ];
  const r = n <= 12 ? 4 : 3;
  const xFn = (i) => xAt(i, n);
  const weak = points.map(isFewDays);
  for (const s of series) {
    const { solid, dotted } = seriesPaths(s.values, weak, xFn, y);
    if (dotted) svgEl('path', { d: dotted, class: `gap-line ${s.cls}` }, svg);
    if (solid) svgEl('path', { d: solid, class: `line ${s.cls}` }, svg);
    s.values.forEach((v, i) => {
      if (v == null) return;
      const cx = xFn(i);
      const cy = y(v);
      // 少ない月の点は白抜きにし、半径を1小さくする（縁のぶん、普通の点より大きく見えないように）
      const size = weak[i] ? r - 1 : r;
      const cls = `dot ${s.cls}${weak[i] ? ' is-few' : ''}`;
      if (s.shape === 'circle') svgEl('circle', { cx, cy, r: size, class: cls }, svg);
      else svgEl('rect', { x: cx - size, y: cy - size, width: size * 2, height: size * 2, class: cls }, svg);
    });
  }
}

// ----- 睡眠時間の棒グラフ -----
function drawSleepChart(points) {
  const svg = sleepChartEl;
  const H = svg.viewBox.baseVal.height;
  const n = points.length;
  const values = points.map((p) => p.sleep);
  const max = Math.max(0, ...values.filter((v) => v != null));
  // 目盛りは4時間刻みで、基本は12時間まで。24時間を超える日（入力ミスなど）があれば、
  // 目盛りが重ならないよう12時間刻みにする。上には棒の数値（2行）が入る余白を2割取る
  const step = max > 24 ? 12 : 4;
  const top = Math.ceil(Math.max(12, max * 1.2) / step) * step;
  const y = yScale(0, top, H);
  svg.replaceChildren();

  for (let h = 0; h <= top; h += step) {
    svgEl('line', { x1: PAD.left, x2: CHART_W - PAD.right, y1: y(h), y2: y(h), class: 'grid-line' }, svg);
    svgEl('text', { x: PAD.left - 6, y: y(h), 'text-anchor': 'end', 'dominant-baseline': 'central', class: 'axis-label' },
      svg, `${h}h`);
  }
  drawXLabels(svg, points, H);

  if (values.every((v) => v == null)) {
    drawEmpty(svg, H);
    return;
  }

  const barW = ((CHART_W - PAD.left - PAD.right) / n) * 0.6;
  values.forEach((v, i) => {
    if (v == null) return;
    svgEl('rect', {
      x: xAt(i, n) - barW / 2, y: y(v), width: barW, height: y(0) - y(v),
      rx: Math.min(4, barW / 3), class: `bar-sleep${isFewSleep(points[i]) ? ' is-few' : ''}`, // 少ない月は淡く
    }, svg);
    // 7日表示のときだけ棒の上に数値を出す（月・年の表示だと詰まって読めない）
    if (n <= 7) drawBarLabel(svg, xAt(i, n), y(v) - 4, formatHours(v));
  });
}

// 棒の上の「8時間10分」。1行だと隣と重なるので「8時間」「10分」の2行にする（下の行が棒のすぐ上）
const BAR_LABEL_LINE = 15;
function drawBarLabel(svg, x, bottomY, text) {
  const parts = text.match(/^(\d+時間)(\d+分)$/);
  const lines = parts ? [parts[1], parts[2]] : [text];
  const label = svgEl('text', { x, y: bottomY - (lines.length - 1) * BAR_LABEL_LINE, 'text-anchor': 'middle', class: 'bar-label' }, svg);
  lines.forEach((line, k) => svgEl('tspan', { x, dy: k ? BAR_LABEL_LINE : 0 }, label, line));
}

// 注記に使う期間の名前。今月・今年は、まだ来ていない日を数えない
function periodLabel(days) {
  if (graphMode === 'week') return '直近7日間';
  const todayKey = toDateKey(new Date());
  const past = days.filter((d) => d.key <= todayKey).length;
  if (graphMode === 'month') {
    return past < days.length ? `${graphMonth + 1}月（${past}日まで）` : `${graphMonth + 1}月の${days.length}日間`;
  }
  const today = fromDateKey(todayKey);
  return past < days.length
    ? `${graphYear}年（${today.getMonth() + 1}月${today.getDate()}日まで）`
    : `${graphYear}年の${days.length}日間`;
}

// ----- 期間平均のカード -----
function renderStats(days) {
  const recs = days.map((d) => d.r).filter(Boolean);
  const withSleep = recs.filter((r) => recordSleeps(r).length);

  const moodAvg = average(recs.map((r) => r.mood));
  const condAvg = average(recs.map((r) => r.condition));
  // 睡眠・就寝時刻は、平均か中央値（statKind）で出す。気分・体調は1〜5の段階なので平均だけ
  const isMedian = statKind === 'median';
  const statName = isMedian ? '中央値' : '平均';
  const sleepList = withSleep.map((r) => totalSleepHours(r));
  const bedtimes = withSleep.map((r) => mainSleep(r).start);
  const sleepStat = isMedian ? median(sleepList) : average(sleepList);
  const bedtime = isMedian ? medianBedtime(bedtimes) : averageBedtime(bedtimes);

  // 平均値を四捨五入して、近い顔アイコンを添える
  const score = (avg, list) => (avg == null ? '—' : `${list[Math.round(avg) - 1].icon} ${avg.toFixed(1)}`);
  const card = (label, value) => `
    <div class="stat">
      <div class="stat-label">${label}</div>
      <div class="stat-value">${value}</div>
    </div>`;

  // 月ごと・年ごとで記録が少ないときは、平均があてにならないことを添える（7日は少なくて当たり前なので添えない）
  const few = graphMode !== 'week' && isFew(recs.length);
  const period = periodLabel(days);
  statsNoteEl.textContent = `${period}のうち ${recs.length}日 記録${few ? '（少ないので参考程度に）' : ''}`;
  statsEl.innerHTML =
    card('気分の平均', score(moodAvg, MOODS)) +
    card('体調の平均', score(condAvg, CONDITIONS)) +
    card(`睡眠の${statName}`, sleepStat == null ? '—' : formatHours(sleepStat)) +
    card(isMedian ? '就寝時刻の中央値' : '平均の就寝時刻', bedtime ?? '—');

  // 読み上げ用に、グラフの内容を文章でも持たせる（絵としてのグラフの代わり）
  const avgText = (avg) => (avg == null ? 'なし' : avg.toFixed(1));
  moodChartEl.setAttribute('aria-label',
    `気分と体調の推移（${period}、記録${recs.length}日）。気分の平均${avgText(moodAvg)}、体調の平均${avgText(condAvg)}`);
  sleepChartEl.setAttribute('aria-label',
    `睡眠時間の推移（${period}）。${statName}${sleepStat == null ? 'なし' : formatHours(sleepStat)}`);
}

// 年ごとの表示の読み上げ用：気分の月平均が一番低い月・高い月。
// 記録が少ない月は除く。表示と同じ小数1桁で比べ、同じ値の月は「2月・9月」と並べる。
// 比べられる月が2つ未満、または全部同じ値なら何も言わない
function yearMoodSummary(points) {
  const months = points
    .filter((p) => p.mood != null && !isFewDays(p))
    .map((p) => ({ name: `${p.month + 1}月`, mood: Number(p.mood.toFixed(1)) }));
  if (months.length < 2) return '';
  const moods = months.map((m) => m.mood);
  const low = Math.min(...moods);
  const high = Math.max(...moods);
  if (low === high) return '';
  const names = (v) => months.filter((m) => m.mood === v).map((m) => m.name).join('・');
  const note = points.some(isFewDays) ? `（記録が${FEW_DAYS}日未満の月は除きます）` : '';
  return `。気分の月平均が一番低いのは${names(low)}（${low.toFixed(1)}）、一番高いのは${names(high)}（${high.toFixed(1)}）${note}`;
}

// 年ごとの表示の下の表：各月の記録日数と月平均。今年は今月まで。記録が少ない月には ※ を付ける
function renderYearTable(points) {
  const now = new Date();
  const lastMonth = graphYear === now.getFullYear() ? now.getMonth() : 11;
  const num = (v) => (v == null ? '—' : v.toFixed(1));
  const mark = (few) => (few ? '※' : '');
  yearTableBody.innerHTML = points.slice(0, lastMonth + 1).map((p) => `
    <tr>
      <th scope="row">${p.month + 1}月${mark(isFewDays(p))}</th>
      <td>${p.count}日</td>
      <td>${num(p.mood)}</td>
      <td>${num(p.condition)}</td>
      <td>${p.sleep == null ? '—' : formatHours(p.sleep) + mark(isFewSleep(p))}</td>
    </tr>`).join('');
}

function renderGraph() {
  clampGraphPeriod();
  const isYear = graphMode === 'year';
  // 月ごと・年ごとの表示のときだけ ‹ › を出す
  graphMonthNavEl.hidden = graphMode === 'week';
  graphTitleEl.textContent = isYear ? `${graphYear}年` : `${graphYear}年${graphMonth + 1}月`;
  graphPrevBtn.setAttribute('aria-label', isYear ? '前の年' : '前の月');
  graphNextBtn.setAttribute('aria-label', isYear ? '次の年' : '次の月');
  // 今月（今年）より先へは進めない。2000年1月（2000年）より前へは戻れない
  graphNextBtn.disabled = isYear ? graphYear >= new Date().getFullYear() : isCurrentOrFutureMonth(graphYear, graphMonth);
  graphPrevBtn.disabled = isYear ? graphYear <= MIN_YEAR : graphYear * 12 + graphMonth <= MIN_YEAR * 12;

  // 年ごとの表示は、グラフは月平均。見出しと凡例もそう読めるようにする
  moodChartTitleEl.textContent = isYear ? '気分・体調（月平均）' : '気分・体調';
  sleepKeyEl.textContent = isYear ? '1日の合計（月平均）' : '1日の合計';

  const records = loadRecords();
  const days = graphDateKeys().map((key) => ({ key, r: records[key] }));
  const points = isYear
    ? Array.from({ length: 12 }, (_, m) => monthPoint(graphYear, m, records))
    : days.map((d) => dayPoint(d.key, d.r));
  renderStats(days);
  drawMoodChart(points);
  drawSleepChart(points);
  chartNoteEl.hidden = !points.some((p) => isFewDays(p) || isFewSleep(p));
  yearTableEl.hidden = !isYear;
  if (isYear) {
    renderYearTable(points);
    moodChartEl.setAttribute('aria-label', moodChartEl.getAttribute('aria-label') + yearMoodSummary(points));
  }
}

// ‹ › で1か月（年ごとの表示は1年）ずらす。行き過ぎた分は renderGraph の clampGraphPeriod で戻る
function moveGraphPeriod(delta) {
  if (graphMode === 'year') {
    graphYear += delta;
  } else {
    const next = shiftMonth(graphYear, graphMonth, delta);
    graphYear = next.year;
    graphMonth = next.month;
  }
  renderGraph();
  // 端に着いてボタンが押せなくなると、フォーカスの行き場がなくなるので反対側へ移す
  if (delta > 0 && graphNextBtn.disabled) graphPrevBtn.focus();
  if (delta < 0 && graphPrevBtn.disabled) graphNextBtn.focus();
}

periodEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-mode]');
  if (!btn) return;
  graphMode = btn.dataset.mode;
  for (const b of periodEl.children) b.setAttribute('aria-pressed', b === btn);
  renderGraph();
});

statKindEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-kind]');
  if (!btn) return;
  statKind = btn.dataset.kind;
  for (const b of statKindEl.children) b.setAttribute('aria-pressed', b === btn);
  renderGraph();
});

graphPrevBtn.addEventListener('click', () => moveGraphPeriod(-1));
graphNextBtn.addEventListener('click', () => moveGraphPeriod(1));
// 注記の「（参考程度に）」は、途中で改行して「に）」だけが次の行に残らないよう、ひとかたまりにする
const fewNote = (text) => [text, Object.assign(document.createElement('span'), { className: 'nowrap', textContent: '（参考程度に）' })];
chartNoteEl.replaceChildren(...fewNote(`白抜きの点・淡い棒は、記録が${FEW_DAYS}日未満の月です`));
document.getElementById('year-table-note').replaceChildren(...fewNote(`※ は記録が${FEW_DAYS}日未満の月です`));
