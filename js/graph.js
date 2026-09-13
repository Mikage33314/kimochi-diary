// ===== グラフ画面 =====
const SVG_NS = 'http://www.w3.org/2000/svg';
const statsEl = document.getElementById('stats');
const statsNoteEl = document.getElementById('stats-note');
const moodChartEl = document.getElementById('chart-mood');
const sleepChartEl = document.getElementById('chart-sleep');
const periodEl = document.getElementById('period');
const graphMonthNavEl = document.getElementById('graph-month-nav');
const graphTitleEl = document.getElementById('graph-title');
const graphPrevBtn = document.getElementById('graph-prev');
const graphNextBtn = document.getElementById('graph-next');

// 表示期間：'week' は今日までの直近7日、'month' は1か月（その月の日数ぶん）
let graphMode = 'week';
let graphYear = new Date().getFullYear();
let graphMonth = new Date().getMonth(); // 0〜11

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

function graphDateKeys() {
  return graphMode === 'week' ? recentDateKeys(7) : monthDateKeys(graphYear, graphMonth);
}

// i 日目の x 座標。各日の「枠」の中央に置くので、棒と折れ線の位置がそろう
function xAt(i, n) {
  const plotW = CHART_W - PAD.left - PAD.right;
  return PAD.left + (i + 0.5) * (plotW / n);
}

// 値 → y 座標の変換関数を作る。SVG は下に行くほど y が大きいので上下を反転させる
function yScale(min, max, height) {
  const plotH = height - PAD.top - PAD.bottom;
  return (v) => PAD.top + (1 - (v - min) / (max - min)) * plotH;
}

// 記録が無い日（null）で線を切る。点が続く間は L（線を引く）、途切れた直後は M（ペンを移動）
function linePath(values, xFn, yFn) {
  let d = '';
  let drawing = false;
  values.forEach((v, i) => {
    if (v == null) {
      drawing = false;
      return;
    }
    d += `${drawing ? 'L' : 'M'}${xFn(i).toFixed(1)},${yFn(v).toFixed(1)} `;
    drawing = true;
  });
  return d.trim();
}

// 記録が無い日をまたいで、前後の点どうしを結ぶ（点線で描く。線が途切れて読めなくならないように）
function gapPath(values, xFn, yFn) {
  let d = '';
  let prev = -1;
  values.forEach((v, i) => {
    if (v == null) return;
    if (prev >= 0 && i - prev > 1) {
      d += `M${xFn(prev).toFixed(1)},${yFn(values[prev]).toFixed(1)} L${xFn(i).toFixed(1)},${yFn(v).toFixed(1)} `;
    }
    prev = i;
  });
  return d.trim();
}

// 下の日付ラベル。7日表示は「9/13」を毎日。月表示は日にちだけを 1日・5の倍数・末日 に付ける
// （末日のすぐ手前の5の倍数＝31日の月の30日 は、ラベルが重なるので省く）
function drawXLabels(svg, keys, height) {
  const n = keys.length;
  keys.forEach((key, i) => {
    const d = fromDateKey(key);
    const day = d.getDate();
    if (graphMode === 'month' && !(day === 1 || day === n || (day % 5 === 0 && n - day >= 2))) return;
    const label = graphMode === 'week' ? `${d.getMonth() + 1}/${day}` : String(day);
    svgEl('text', { x: xAt(i, n), y: height - 6, 'text-anchor': 'middle', class: 'axis-label' }, svg, label);
  });
}

function drawEmpty(svg, height) {
  svgEl('text', { x: CHART_W / 2, y: (height - PAD.bottom) / 2 + PAD.top / 2, 'text-anchor': 'middle', class: 'empty-label' },
    svg, 'この期間の記録はありません');
}

// ----- 気分・体調の折れ線 -----
function drawMoodChart(days) {
  const svg = moodChartEl;
  const H = svg.viewBox.baseVal.height; // 高さは HTML の viewBox から読む
  const n = days.length;
  const y = yScale(1, 5, H);
  svg.replaceChildren();
  svg.classList.toggle('is-dense', n > 7);

  // 横の目盛り線と、左端の顔アイコン
  for (const m of MOODS) {
    svgEl('line', { x1: PAD.left, x2: CHART_W - PAD.right, y1: y(m.value), y2: y(m.value), class: 'grid-line' }, svg);
    svgEl('text', { x: PAD.left - 8, y: y(m.value), 'text-anchor': 'end', 'dominant-baseline': 'central', class: 'axis-icon' },
      svg, m.icon);
  }
  drawXLabels(svg, days.map((d) => d.key), H);

  if (!days.some((d) => d.r)) {
    drawEmpty(svg, H);
    return;
  }

  // 気分は実線と丸、体調は破線と四角。色だけに頼らず、線と点の形でも見分けられるようにする
  const series = [
    { cls: 'series-mood', shape: 'circle', values: days.map((d) => d.r?.mood ?? null) },
    { cls: 'series-condition', shape: 'square', values: days.map((d) => d.r?.condition ?? null) },
  ];
  const r = n <= 7 ? 4 : 3;
  const xFn = (i) => xAt(i, n);
  for (const s of series) {
    const gaps = gapPath(s.values, xFn, y);
    if (gaps) svgEl('path', { d: gaps, class: `gap-line ${s.cls}` }, svg);
    svgEl('path', { d: linePath(s.values, xFn, y), class: `line ${s.cls}` }, svg);
    s.values.forEach((v, i) => {
      if (v == null) return;
      const cx = xFn(i);
      const cy = y(v);
      if (s.shape === 'circle') svgEl('circle', { cx, cy, r, class: `dot ${s.cls}` }, svg);
      else svgEl('rect', { x: cx - r, y: cy - r, width: r * 2, height: r * 2, class: `dot ${s.cls}` }, svg);
    });
  }
}

// ----- 睡眠時間の棒グラフ -----
function drawSleepChart(days) {
  const svg = sleepChartEl;
  const H = svg.viewBox.baseVal.height;
  const n = days.length;
  const values = days.map((d) => (d.r?.sleeps.length ? totalSleepHours(d.r) : null));
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
  drawXLabels(svg, days.map((d) => d.key), H);

  if (values.every((v) => v == null)) {
    drawEmpty(svg, H);
    return;
  }

  const barW = ((CHART_W - PAD.left - PAD.right) / n) * 0.6;
  values.forEach((v, i) => {
    if (v == null) return;
    svgEl('rect', {
      x: xAt(i, n) - barW / 2, y: y(v), width: barW, height: y(0) - y(v),
      rx: Math.min(4, barW / 3), class: 'bar-sleep',
    }, svg);
    // 7日表示のときだけ棒の上に数値を出す（月表示だと詰まって読めない）
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

// 注記に使う期間の名前。今月は、まだ来ていない日を数えない
function periodLabel(days) {
  if (graphMode === 'week') return '直近7日間';
  const todayKey = toDateKey(new Date());
  const past = days.filter((d) => d.key <= todayKey).length;
  return past < days.length ? `${graphMonth + 1}月（${past}日まで）` : `${graphMonth + 1}月の${days.length}日間`;
}

// ----- 期間平均のカード -----
function renderStats(days) {
  const recs = days.map((d) => d.r).filter(Boolean);
  const withSleep = recs.filter((r) => r.sleeps.length);

  const moodAvg = average(recs.map((r) => r.mood));
  const condAvg = average(recs.map((r) => r.condition));
  const sleepAvg = average(withSleep.map((r) => totalSleepHours(r)));
  const bedtime = averageBedtime(withSleep.map((r) => mainSleep(r).start));

  // 平均値を四捨五入して、近い顔アイコンを添える
  const score = (avg, list) => (avg == null ? '—' : `${list[Math.round(avg) - 1].icon} ${avg.toFixed(1)}`);
  const card = (label, value) => `
    <div class="stat">
      <div class="stat-label">${label}</div>
      <div class="stat-value">${value}</div>
    </div>`;

  const period = periodLabel(days);
  statsNoteEl.textContent = `${period}のうち ${recs.length}日 記録`;
  statsEl.innerHTML =
    card('気分の平均', score(moodAvg, MOODS)) +
    card('体調の平均', score(condAvg, CONDITIONS)) +
    card('睡眠の平均', sleepAvg == null ? '—' : formatHours(sleepAvg)) +
    card('平均の就寝時刻', bedtime ?? '—');

  // 読み上げ用に、グラフの内容を文章でも持たせる（絵としてのグラフの代わり）
  const avgText = (avg) => (avg == null ? 'なし' : avg.toFixed(1));
  moodChartEl.setAttribute('aria-label',
    `気分と体調の推移（${period}、記録${recs.length}日）。気分の平均${avgText(moodAvg)}、体調の平均${avgText(condAvg)}`);
  sleepChartEl.setAttribute('aria-label',
    `睡眠時間の推移（${period}）。平均${sleepAvg == null ? 'なし' : formatHours(sleepAvg)}`);
}

function renderGraph() {
  // 月ごと表示のときだけ ‹ 2026年9月 › を出す
  graphMonthNavEl.hidden = graphMode !== 'month';
  graphTitleEl.textContent = `${graphYear}年${graphMonth + 1}月`;
  graphNextBtn.disabled = isCurrentOrFutureMonth(graphYear, graphMonth); // 今月より先へは進めない

  const records = loadRecords();
  const days = graphDateKeys().map((key) => ({ key, r: records[key] }));
  renderStats(days);
  drawMoodChart(days);
  drawSleepChart(days);
}

function moveGraphMonth(delta) {
  const next = shiftMonth(graphYear, graphMonth, delta);
  graphYear = next.year;
  graphMonth = next.month;
  renderGraph();
  // 今月に着いて › が押せなくなると、フォーカスの行き場がなくなるので ‹ へ移す
  if (delta > 0 && graphNextBtn.disabled) graphPrevBtn.focus();
}

periodEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-mode]');
  if (!btn) return;
  graphMode = btn.dataset.mode;
  for (const b of periodEl.children) b.setAttribute('aria-pressed', b === btn);
  renderGraph();
});

graphPrevBtn.addEventListener('click', () => moveGraphMonth(-1));
graphNextBtn.addEventListener('click', () => moveGraphMonth(1));
