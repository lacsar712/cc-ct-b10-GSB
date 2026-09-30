import { createSignal, createEffect, For, Show, onCleanup } from "solid-js";
import {
  createCheckout,
  fetchCheckout,
  fetchCheckouts,
  fetchPairDiff,
  fetchTrackPoints,
} from "./api";
import TrendChart from "./TrendChart";

const LIMITS = [5, 10, 20];

function fmtTime(iso) {
  return iso ? new Date(iso).toLocaleString() : "—";
}

function verdictClass(v) {
  return v === "合格" ? "pass" : v === "超差" ? "fail" : "";
}

function PairCard(props) {
  const p = () => props.pair;
  return (
    <div class="pair-card">
      <div class="pair-head">
        <h3>两点差值（后台计算）</h3>
        <span class={`chip ${verdictClass(p().verdict)}`}>{p().verdict}</span>
      </div>
      <div class="pair-points">
        <div class="pair-point">
          <span class="tag jia">甲</span>
          <strong>{p().a.tool_code}</strong>
          <span>{p().a.offset_um} µm</span>
          <span class="hint">{fmtTime(p().a.created_at)}</span>
        </div>
        <div class="pair-arrow">→</div>
        <div class="pair-point">
          <span class="tag yi">乙</span>
          <strong>{p().b.tool_code}</strong>
          <span>{p().b.offset_um} µm</span>
          <span class="hint">{fmtTime(p().b.created_at)}</span>
        </div>
      </div>
      <p class="pair-math">
        乙 − 甲 = <strong>{p().delta_um} µm</strong>
        {"　"}差值绝对值 <strong>{p().abs_delta_um} µm</strong>
        {"　"}（合格带 ±{p().tolerance_um} µm，{p().within_tolerance ? "未超差" : "超差"}）
      </p>
      {props.frozen && <p class="frozen-note">本差值随副本冻住，不再随后续判定改变。</p>}
    </div>
  );
}

function PointTable(props) {
  return (
    <table>
      <thead>
        <tr>
          <th>序</th>
          <th>选作甲</th>
          <th>选作乙</th>
          <th>刀具</th>
          <th>刀补 µm</th>
          <th>结论</th>
          <th>结清时间</th>
        </tr>
      </thead>
      <tbody>
        <For each={props.points}>
          {(p, i) => (
            <tr>
              <td class="hint">{i() + 1}</td>
              <td>
                <input
                  type="radio"
                  name="pick-first"
                  checked={props.firstId === p.id}
                  disabled={props.readonly}
                  onChange={() => props.onPick?.(p.id, "first")}
                  aria-label={`把 ${p.tool_code} 选作甲点`}
                />
              </td>
              <td>
                <input
                  type="radio"
                  name="pick-second"
                  checked={props.secondId === p.id}
                  disabled={props.readonly}
                  onChange={() => props.onPick?.(p.id, "second")}
                  aria-label={`把 ${p.tool_code} 选作乙点`}
                />
              </td>
              <td>{p.tool_code}</td>
              <td>{p.offset_um}</td>
              <td class={verdictClass(p.verdict)}>{p.verdict || "—"}</td>
              <td>{fmtTime(p.reviewed_at || p.created_at)}</td>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  );
}

function CheckoutList(props) {
  return (
    <section class="card">
      <h2>已签出区（只读副本）</h2>
      <Show when={props.items.length} fallback={<p class="hint">尚无签出副本。</p>}>
        <table>
          <thead>
            <tr>
              <th>副本</th>
              <th>签出时间</th>
              <th>操作员</th>
              <th>点数</th>
              <th>冻结差值</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <For each={props.items}>
              {(co) => (
                <tr>
                  <td>#{co.id}</td>
                  <td>{fmtTime(co.created_at)}</td>
                  <td>{co.created_by || "—"}</td>
                  <td>{co.point_count}</td>
                  <td>
                    <Show when={co.pair} fallback={<span class="hint">仅点集</span>}>
                      <span>
                        {co.pair.a.tool_code}→{co.pair.b.tool_code}｜|Δ|{" "}
                        <strong>{co.pair.abs_delta_um}</strong> µm
                      </span>
                      <span class={`chip ${verdictClass(co.pair.verdict)}`}>
                        {co.pair.verdict}
                      </span>
                    </Show>
                  </td>
                  <td>
                    <a class="link-btn" href={`#/checkout/${co.id}`}>
                      打开副本
                    </a>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </section>
  );
}

export function TrackView(props) {
  const [limit, setLimit] = createSignal(10);
  const [points, setPoints] = createSignal([]);
  const [firstId, setFirstId] = createSignal(null);
  const [secondId, setSecondId] = createSignal(null);
  const [diff, setDiff] = createSignal(null);
  const [diffLoading, setDiffLoading] = createSignal(false);
  const [checkouts, setCheckouts] = createSignal([]);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");

  async function loadPoints() {
    try {
      const data = await fetchTrackPoints(limit());
      setPoints(data.points);
    } catch (e) {
      setError(e.message);
    }
  }

  async function loadCheckouts() {
    try {
      setCheckouts(await fetchCheckouts());
    } catch (e) {
      setError(e.message);
    }
  }

  // 切条数：重新拉近次结清，清空旧选择与旧差值（差值只对应原两点）
  createEffect(() => {
    limit();
    setFirstId(null);
    setSecondId(null);
    setDiff(null);
    setError("");
    loadPoints();
  });

  // 在线轨迹自动刷新：新判定只刷这里，既有签出副本不受影响
  const timer = setInterval(() => {
    loadPoints();
    loadCheckouts();
  }, 4000);
  onCleanup(() => clearInterval(timer));

  loadCheckouts();

  function pick(id, slot) {
    if (slot === "first") {
      setFirstId(id);
      if (secondId() === id) setSecondId(null);
    } else {
      setSecondId(id);
      if (firstId() === id) setFirstId(null);
    }
    setDiff(null);
  }

  async function calcDiff() {
    if (firstId() == null || secondId() == null) return;
    setDiffLoading(true);
    setError("");
    try {
      // 页面绝不自行相减：把两个点交后台，差值以返回为准
      setDiff(await fetchPairDiff(firstId(), secondId()));
    } catch (e) {
      setError(e.message);
    } finally {
      setDiffLoading(false);
    }
  }

  async function checkout() {
    setBusy(true);
    setError("");
    try {
      const co = await createCheckout({
        limit: limit(),
        firstId: firstId(),
        secondId: secondId(),
      });
      await loadCheckouts();
      location.hash = `#/checkout/${co.id}`;
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const canWrite = () => props.user.can_write;

  return (
    <>
      <Show when={error()}>
        <div class="banner error">{error()}</div>
      </Show>

      <section class="card">
        <div class="toolbar wrap">
          <h2>在线连线台</h2>
          <div class="limit-row">
            <span class="hint">条数选择：</span>
            <For each={LIMITS}>
              {(n) => (
                <button
                  type="button"
                  class={limit() === n ? "" : "ghost"}
                  onClick={() => setLimit(n)}
                >
                  近 {n} 次
                </button>
              )}
            </For>
            <span class="hint">每 4 秒自动刷新在线轨迹</span>
          </div>
        </div>

        <TrendChart points={points()} selected={[firstId(), secondId()].filter((x) => x != null)} />

        <div class="toolbar wrap diff-bar">
          <div class="hint">
            在点表挑两个点（甲、乙），交后台算差值；
            {canWrite() ? "操作员可把当前点集与差值签出为只读副本。" : "复核员可查看，签出仅操作员可执行。"}
          </div>
          <div class="btn-row">
            <button
              type="button"
              class="ghost"
              disabled={firstId() == null || secondId() == null || diffLoading()}
              onClick={calcDiff}
            >
              {diffLoading() ? "后台计算中…" : "交后台算差值"}
            </button>
            <Show
              when={canWrite()}
              fallback={<span class="readonly-tag">只读账号不可签出</span>}
            >
              <button type="button" disabled={busy()} onClick={checkout}>
                {busy() ? "签出中…" : "签出只读副本"}
              </button>
            </Show>
          </div>
        </div>

        <Show when={firstId() == null || secondId() == null}>
          <p class="hint">提示：需各选一个甲点与乙点（不可为同一点）后才能算差值。</p>
        </Show>
      </section>

      <Show when={diff()}>
        {(d) => (
          <section class="card">
            <PairCard pair={d()} />
          </section>
        )}
      </Show>

      <section class="card">
        <h2>点表对照区（近 {limit()} 次结清，按时间倒序，与总览同序）</h2>
        <PointTable
          points={points()}
          firstId={firstId()}
          secondId={secondId()}
          onPick={pick}
        />
        <Show when={!points().length}>
          <p class="hint">暂无结清点，待 worker 完成复核后即在此连线。</p>
        </Show>
      </section>

      <CheckoutList items={checkouts()} />
    </>
  );
}

export function CheckoutView(props) {
  const [co, setCo] = createSignal(null);
  const [error, setError] = createSignal("");

  // 注意：本页不做任何自动刷新——副本是只读快照，打开即停在签出版
  createEffect(() => {
    const id = props.id;
    if (!id) return;
    fetchCheckout(id)
      .then(setCo)
      .catch((e) => {
        setError(e.message);
        setCo(null);
      });
  });

  return (
    <section class="card">
      <div class="toolbar">
        <h2>签出只读副本</h2>
        <a class="link-btn" href="#/track">
          返回在线连线台
        </a>
      </div>

      <Show when={error()}>
        <div class="banner error">{error()}</div>
      </Show>

      <Show when={co()} fallback={<p class="hint">加载中…</p>}>
        {(c) => (
          <>
            <div class="frozen-banner">
              副本 <strong>#{c().id}</strong> 已冻住签出时刻的 {c().point_count}{" "}
              个点
              <Show when={c().pair}>与两点差值</Show>
              。随后新提交、新判定只刷新在线轨迹，本副本保持不动。
              <div class="hint">
                操作员：{c().created_by || "—"}　签出时间：{fmtTime(c().created_at)}
              </div>
            </div>

            <TrendChart
              points={c().points}
              selected={c().pair ? [c().pair.a.id, c().pair.b.id] : []}
            />

            <Show when={c().pair}>
              {(p) => <PairCard pair={p()} frozen />}
            </Show>

            <h3 class="subhead">冻结点表（{c().point_count} 点）</h3>
            <PointTable
              points={c().points}
              firstId={c().pair ? c().pair.a.id : null}
              secondId={c().pair ? c().pair.b.id : null}
              readonly
            />
          </>
        )}
      </Show>
    </section>
  );
}
