import { createSignal, For, Show } from "solid-js";

// 颜色只做辅助：合格/超差同时用「形状 + 文字标签」区分，不单靠颜色
const PASS = "#15803d";
const FAIL_DOT = "#c2410c"; // 橙红：与合格绿的色盲混淆距离达标（配形状二次编码）

const W = 720;
const H = 260;
const M = { l: 46, r: 18, t: 18, b: 38 };
const PW = W - M.l - M.r;
const PH = H - M.t - M.b;

function fmtTime(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function TrendChart(props) {
  const [hover, setHover] = createSignal(null); // {x, y, point}

  // 表格按时间倒序（新在上），连线按时间正序（旧→新）——同一批点、同一时间口径
  const chrono = () => [...(props.points || [])].reverse();

  function scales() {
    const pts = chrono();
    const vals = pts.map((p) => p.offset_um);
    const rawLo = Math.min(0, -12, ...vals);
    const rawHi = Math.max(0, 12, ...vals);
    const pad = Math.max(2, Math.ceil((rawHi - rawLo) * 0.12));
    const lo = rawLo - pad;
    const hi = rawHi + pad;
    const x = (i) =>
      pts.length <= 1 ? M.l + PW / 2 : M.l + (i / (pts.length - 1)) * PW;
    const y = (v) => M.t + ((hi - v) / (hi - lo || 1)) * PH;
    return { pts, x, y, lo, hi };
  }

  function ticks() {
    const { lo, hi } = scales();
    const set = new Set([-12, 0, 12]);
    if (lo < -12) set.add(Math.ceil(lo / 4) * 4);
    if (hi > 12) set.add(Math.floor(hi / 4) * 4);
    return [...set].filter((v) => v >= lo && v <= hi).sort((a, b) => a - b);
  }

  function linePath() {
    const { pts, x, y } = scales();
    return pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.offset_um)}`).join(" ");
  }

  function labelIndexes() {
    const n = chrono().length;
    if (n === 0) return [];
    if (n === 1) return [0];
    const want = Math.min(5, n);
    const idxs = new Set();
    for (let k = 0; k < want; k++) idxs.add(Math.round((k / (want - 1)) * (n - 1)));
    return [...idxs].sort((a, b) => a - b);
  }

  function onMove(e) {
    const { pts, x } = scales();
    if (!pts.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestD = Infinity;
    pts.forEach((_, i) => {
      const d = Math.abs(x(i) - px);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setHover({ index: best, ratioX: x(best) / W, point: pts[best] });
  }

  const xLabels = () => {
    const { pts, x } = scales();
    return labelIndexes().map((i) => ({ i, x: x(i), t: fmtTime(pts[i].created_at) }));
  };

  return (
    <div
      class="chart-wrap"
      onMouseLeave={() => setHover(null)}
    >
      <svg viewBox={`0 0 ${W} ${H}`} class="trend-svg" role="img"
        aria-label="近次结清刀补随时间连线，圆点为合格，菱形为超差">
        {/* 合格公差带 ±12µm */}
        <rect
          x={M.l}
          y={scales().y(12)}
          width={PW}
          height={scales().y(-12) - scales().y(12)}
          class="band"
        />
        <line x1={M.l} x2={M.l + PW} y1={scales().y(12)} y2={scales().y(12)} class="band-edge" />
        <line x1={M.l} x2={M.l + PW} y1={scales().y(-12)} y2={scales().y(-12)} class="band-edge" />
        <text x={M.l + PW - 4} y={scales().y(12) - 4} class="band-label" text-anchor="end">
          合格带 ±12µm
        </text>

        {/* 网格 / Y 轴刻度 */}
        <For each={ticks()}>
          {(t) => (
            <g>
              <line x1={M.l} x2={M.l + PW} y1={scales().y(t)} y2={scales().y(t)}
                class={t === 0 ? "zero-line" : "grid-line"} />
              <text x={M.l - 8} y={scales().y(t) + 4} class="axis-label" text-anchor="end">
                {t}
              </text>
            </g>
          )}
        </For>

        {/* 时间轴标签 */}
        <For each={xLabels()}>
          {(l) => (
            <text x={l.x} y={H - M.b + 20} class="axis-label" text-anchor="middle">
              {l.t}
            </text>
          )}
        </For>

        {/* 连线 */}
        <Show when={chrono().length > 1}>
          <path d={linePath()} class="trend-line" fill="none" />
        </Show>

        {/* 点位：合格圆、超差菱，加白描边与连线分离 */}
        <For each={scales().pts}>
          {(p, i) => {
            const cx = scales().x(i());
            const cy = scales().y(p.offset_um);
            const isPass = p.verdict === "合格";
            const picked = (props.selected || []).includes(p.id);
            return (
              <g>
                <Show
                  when={isPass}
                  fallback={
                    <rect
                      x={cx - 5.5}
                      y={cy - 5.5}
                      width={11}
                      height={11}
                      transform={`rotate(45 ${cx} ${cy})`}
                      fill={FAIL_DOT}
                      stroke="#fff"
                      stroke-width={2}
                      class={picked ? "marker picked" : "marker"}
                    >
                      <title>{`${p.tool_code} ${p.offset_um}µm · 超差`}</title>
                    </rect>
                  }
                >
                  <circle
                    cx={cx}
                    cy={cy}
                    r={5.5}
                    fill={PASS}
                    stroke="#fff"
                    stroke-width={2}
                    class={picked ? "marker picked" : "marker"}
                  >
                    <title>{`${p.tool_code} ${p.offset_um}µm · 合格`}</title>
                  </circle>
                </Show>
              </g>
            );
          }}
        </For>

        {/* 十字线 */}
        <Show when={hover()}>
          {(h) => (
            <line
              x1={scales().x(h().index)}
              x2={scales().x(h().index)}
              y1={M.t}
              y2={M.t + PH}
              class="crosshair"
            />
          )}
        </Show>

        {/* 交互层 */}
        <rect
          x={M.l}
          y={M.t}
          width={PW}
          height={PH}
          fill="transparent"
          onMouseMove={onMove}
        />
      </svg>

      <Show when={hover()}>
        {(h) => (
          <div
            class="chart-tip"
            style={{
              left: `${Math.min(82, Math.max(8, h().ratioX * 100))}%`,
            }}
          >
            <strong>{h().point.tool_code}</strong>
            <span>刀补 {h().point.offset_um} µm</span>
            <span class={h().point.verdict === "合格" ? "pass" : "fail"}>
              {h().point.verdict}
            </span>
            <span class="tip-time">{fmtTime(h().point.created_at)}</span>
          </div>
        )}
      </Show>

      <div class="chart-legend">
        <span><i class="lg-line" />刀补连线（旧→新）</span>
        <span><i class="lg-pass" />合格</span>
        <span><i class="lg-fail" />超差</span>
      </div>
    </div>
  );
}
