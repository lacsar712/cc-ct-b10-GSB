import { createMemo, createSignal, For, Show } from "solid-js";

const INK = {
  line: "#2a78d6",
  pass: "#0ca30c",
  fail: "#d03b3b",
  grid: "#e1e0d9",
  axis: "#c3c2b7",
  muted: "#898781",
  surface: "#ffffff",
};

const W = 720;
const H = 280;
const PAD = { top: 24, right: 20, bottom: 40, left: 46 };

function fmtTime(iso) {
  return new Date(iso).toLocaleString();
}

function fmtTick(iso) {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(
    d.getHours()
  ).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// 近次点按时间排出：接口给的是 -created_at（与首页同序），图上反转为时间正序
function chronological(points) {
  return [...points].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);
}

export default function TrendChart(props) {
  const [hover, setHover] = createSignal(null);

  const series = createMemo(() => chronological(props.points || []));

  const scales = createMemo(() => {
    const pts = series();
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    if (!pts.length) return null;
    const times = pts.map((p) => new Date(p.created_at).getTime());
    const vals = pts.map((p) => p.offset_um);
    let tMin = Math.min(...times);
    let tMax = Math.max(...times);
    if (tMin === tMax) {
      tMin -= 60_000;
      tMax += 60_000;
    }
    let vMin = Math.min(0, ...vals);
    let vMax = Math.max(0, ...vals);
    const vPad = Math.max(2, Math.round((vMax - vMin) * 0.12));
    vMin -= vPad;
    vMax += vPad;
    const x = (t) => PAD.left + ((t - tMin) / (tMax - tMin)) * innerW;
    const y = (v) => PAD.top + (1 - (v - vMin) / (vMax - vMin)) * innerH;
    // y 轴取整齐刻度
    const span = vMax - vMin;
    const rawStep = span / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= rawStep) || rawStep;
    const ticks = [];
    for (let v = Math.ceil(vMin / step) * step; v <= vMax; v += step) ticks.push(Math.round(v));
    return { x, y, tMin, tMax, vMin, vMax, ticks };
  });

  const linePath = createMemo(() => {
    const s = scales();
    const pts = series();
    if (!s || pts.length < 2) return "";
    return pts
      .map((p, i) => `${i === 0 ? "M" : "L"}${s.x(new Date(p.created_at).getTime()).toFixed(1)},${s.y(p.offset_um).toFixed(1)}`)
      .join(" ");
  });

  const xTicks = createMemo(() => {
    const pts = series();
    const s = scales();
    if (!s || !pts.length) return [];
    const n = pts.length;
    const idxs = n <= 5 ? pts.map((_, i) => i) : [0, Math.floor((n - 1) / 2), n - 1];
    return [...new Set(idxs)].map((i) => pts[i]);
  });

  function isSelected(id) {
    return (props.selectedIds || []).includes(id);
  }

  function onMove(e) {
    const s = scales();
    const pts = series();
    if (!s || !pts.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * W;
    let best = pts[0];
    let bestD = Infinity;
    for (const p of pts) {
      const px = s.x(new Date(p.created_at).getTime());
      const d = Math.abs(px - mx);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    const t = new Date(best.created_at).getTime();
    setHover({
      point: best,
      x: s.x(t),
      y: s.y(best.offset_um),
      pxRect: rect,
    });
  }

  return (
    <div class="chart-wrap">
      <div class="chart-legend">
        <span class="legend-item">
          <svg width="14" height="14"><line x1="1" y1="7" x2="13" y2="7" stroke={INK.line} stroke-width="2" /></svg>
          刀补轨迹
        </span>
        <span class="legend-item">
          <svg width="14" height="14"><circle cx="7" cy="7" r="5" fill={INK.pass} stroke="#fff" stroke-width="1.5" /></svg>
          合格
        </span>
        <span class="legend-item">
          <svg width="14" height="14"><rect x="2.5" y="2.5" width="9" height="9" fill={INK.fail} stroke="#fff" stroke-width="1.5" /></svg>
          超差
        </span>
      </div>
      <svg
        class="trend-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="近次已结清刀补按时间连线图，点形区分合格与超差"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <Show when={scales()} fallback={<text x={W / 2} y={H / 2} text-anchor="middle" fill={INK.muted}>暂无已结清点</text>}>
          {(s) => (
            <>
              <For each={s().ticks}>
                {(v) => (
                  <g>
                    <line
                      x1={PAD.left}
                      x2={W - PAD.right}
                      y1={s().y(v)}
                      y2={s().y(v)}
                      stroke={v === 0 ? INK.axis : INK.grid}
                      stroke-width={v === 0 ? 1.5 : 1}
                    />
                    <text x={PAD.left - 8} y={s().y(v) + 4} text-anchor="end" font-size="11" fill={INK.muted}>
                      {v}
                    </text>
                  </g>
                )}
              </For>
              <line x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={H - PAD.bottom} stroke={INK.axis} stroke-width="1.5" />
              <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} stroke={INK.axis} stroke-width="1.5" />
              <For each={xTicks()}>
                {(p) => (
                  <text x={s().x(new Date(p.created_at).getTime())} y={H - PAD.bottom + 18} text-anchor="middle" font-size="11" fill={INK.muted}>
                    {fmtTick(p.created_at)}
                  </text>
                )}
              </For>
              <text x={PAD.left - 36} y={PAD.top - 8} font-size="11" fill={INK.muted}>
                µm
              </text>

              <Show when={series().length >= 2}>
                <path d={linePath()} fill="none" stroke={INK.line} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
              </Show>

              <For each={series()}>
                {(p) => {
                  const cx = s().x(new Date(p.created_at).getTime());
                  const cy = s().y(p.offset_um);
                  const sel = isSelected(p.id);
                  return (
                    <g>
                      <Show when={sel}>
                        <circle cx={cx} cy={cy} r="9.5" fill="none" stroke={INK.line} stroke-width="2" />
                      </Show>
                      <Show
                        when={p.verdict === "合格"}
                        fallback={
                          <rect
                            x={cx - 5}
                            y={cy - 5}
                            width="10"
                            height="10"
                            fill={INK.fail}
                            stroke={INK.surface}
                            stroke-width="2"
                          />
                        }
                      >
                        <circle cx={cx} cy={cy} r="5" fill={INK.pass} stroke={INK.surface} stroke-width="2" />
                      </Show>
                      <Show when={sel}>
                        <text x={cx} y={cy - 13} text-anchor="middle" font-size="11" font-weight="600" fill="#1a2332">
                          {p.tool_code}
                        </text>
                      </Show>
                    </g>
                  );
                }}
              </For>

              <Show when={hover()}>
                {(h) => (
                  <line
                    x1={h().x}
                    x2={h().x}
                    y1={PAD.top}
                    y2={H - PAD.bottom}
                    stroke={INK.axis}
                    stroke-width="1"
                    stroke-dasharray="3 3"
                    pointer-events="none"
                  />
                )}
              </Show>
              <rect x={PAD.left} y={PAD.top} width={W - PAD.left - PAD.right} height={H - PAD.top - PAD.bottom} fill="transparent" />
            </>
          )}
        </Show>
      </svg>
      <Show when={hover()}>
        {(h) => {
          const p = h().point;
          const rect = h().pxRect;
          const leftPct = (h().x / W) * rect.width;
          const flip = leftPct > rect.width * 0.62;
          return (
            <div
              class="chart-tip"
              style={{
                left: `${(leftPct / rect.width) * 100}%`,
                transform: flip ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
              }}
            >
              <strong>{p.tool_code}</strong>
              <span>刀补：{p.offset_um} µm</span>
              <span class={p.verdict === "合格" ? "pass" : p.verdict === "超差" ? "fail" : ""}>
                结论：{p.verdict || "—"}
              </span>
              <span class="tip-time">{fmtTime(p.created_at)}</span>
            </div>
          );
        }}
      </Show>
    </div>
  );
}
