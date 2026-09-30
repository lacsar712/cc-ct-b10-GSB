import { createSignal, createEffect, createMemo, For, Show, onCleanup } from "solid-js";
import {
  checkoutTrend,
  compareTrend,
  fetchSnapshot,
  fetchSnapshots,
  fetchTrendPoints,
} from "./api";
import TrendChart from "./TrendChart";

const LIMITS = [5, 10, 20];

function fmtTime(iso) {
  return iso ? new Date(iso).toLocaleString() : "—";
}

function DiffPanel(props) {
  const pair = () => props.pair;
  return (
    <Show when={pair()}>
      {(p) => (
        <div class="diff-box">
          <div class="diff-row">
            <span class="diff-tag tag-a">第一点</span>
            <strong>{p().first_tool_code}</strong>
            <span class="muted">{p().first_offset_um} µm</span>
          </div>
          <div class="diff-arrow">→</div>
          <div class="diff-row">
            <span class="diff-tag tag-b">第二点</span>
            <strong>{p().second_tool_code}</strong>
            <span class="muted">{p().second_offset_um} µm</span>
          </div>
          <div class="diff-result">
            <span class="muted">后台差值（第二点 − 第一点）</span>
            <strong class="diff-num">
              {p().diff_um > 0 ? "▲" : p().diff_um < 0 ? "▼" : "="} {p().diff_um} µm
            </strong>
            <span class="muted">绝对差值 {p().abs_diff_um} µm</span>
          </div>
        </div>
      )}
    </Show>
  );
}

function PointTable(props) {
  // props.points 已按 -created_at 排列（与首页表一致）；两列为第一点/第二点选点
  const picks = () => props.picks || [null, null];
  return (
    <table class="point-table">
      <thead>
        <tr>
          <th>第一点</th>
          <th>第二点</th>
          <th>#</th>
          <th>刀具</th>
          <th>刀补 µm</th>
          <th>结论</th>
          <th>提交时间</th>
          <th>复核时间</th>
        </tr>
      </thead>
      <tbody>
        <For each={props.points}>
          {(p) => (
            <tr classList={{ "row-picked": picks().includes(p.id) }}>
              <td>
                <input
                  type="radio"
                  name="pick-first"
                  aria-label={`选 ${p.tool_code} 为第一点`}
                  checked={picks()[0] === p.id}
                  disabled={props.readonly}
                  onChange={() => props.onPick?.(0, p.id)}
                />
              </td>
              <td>
                <input
                  type="radio"
                  name="pick-second"
                  aria-label={`选 ${p.tool_code} 为第二点`}
                  checked={picks()[1] === p.id}
                  disabled={props.readonly}
                  onChange={() => props.onPick?.(1, p.id)}
                />
              </td>
              <td class="muted">{p.id}</td>
              <td>{p.tool_code}</td>
              <td>{p.offset_um}</td>
              <td class={p.verdict === "合格" ? "pass" : p.verdict === "超差" ? "fail" : ""}>
                {p.verdict === "合格" ? "● 合格" : p.verdict === "超差" ? "■ 超差" : "—"}
              </td>
              <td>{fmtTime(p.created_at)}</td>
              <td>{fmtTime(p.reviewed_at)}</td>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  );
}

export function TrendDesk(props) {
  const [limit, setLimit] = createSignal(10);
  const [points, setPoints] = createSignal([]);
  const [picks, setPicks] = createSignal([null, null]);
  const [pair, setPair] = createSignal(null);
  const [snapshots, setSnapshots] = createSignal([]);
  const [loading, setLoading] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [notice, setNotice] = createSignal("");

  let pointsSeq = 0;

  async function loadPoints() {
    const seq = ++pointsSeq;
    const wanted = limit();
    setLoading(true);
    try {
      const data = await fetchTrendPoints(wanted);
      if (seq !== pointsSeq) return; // 切换条数后的过期响应丢弃
      setPoints(data.points);
      // 新判定只刷新在线轨迹；已不在近次点集的选点自动失效，保留仍在的点
      const ids = new Set(data.points.map((p) => p.id));
      setPicks((prev) => prev.map((id) => (id != null && ids.has(id) ? id : null)));
    } catch (e) {
      if (seq === pointsSeq) setError(e.message);
    } finally {
      if (seq === pointsSeq) setLoading(false);
    }
  }

  async function loadSnapshots() {
    try {
      setSnapshots(await fetchSnapshots());
    } catch (e) {
      // 已签出区加载失败不打断连线台
      setError(e.message);
    }
  }

  createEffect(() => {
    limit();
    setPair(null);
    loadPoints();
  });

  // 在线轨迹轮询：新判定/多投后自动与首页同序刷新，既有副本不受影响
  const timer = setInterval(loadPoints, 3000);
  onCleanup(() => clearInterval(timer));
  createEffect(() => {
    if (!props.user) return;
    loadSnapshots();
  });

  function onPick(slot, id) {
    setError("");
    setPicks((prev) => {
      const next = [...prev];
      next[slot] = next[slot] === id ? null : id;
      return next;
    });
  }

  async function handleCompare() {
    const [a, b] = picks();
    if (a == null || b == null) {
      setError("请在点表中挑两个点（第一点、第二点各一个）");
      return;
    }
    setBusy(true);
    setError("");
    try {
      // 差值交后台计算，页面只负责展示返回值，不自行相减
      setPair(await compareTrend({ limit: limit(), first_id: a, second_id: b }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCheckout() {
    const [a, b] = picks();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const snap = await checkoutTrend({
        limit: limit(),
        first_id: a,
        second_id: b,
      });
      setNotice(`已签出只读副本 #${snap.id}：点集与差值已冻结，后续新判定不再改动它。`);
      await loadSnapshots();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const canCheckout = () => !!props.user?.can_write;

  return (
    <section class="card">
      <div class="toolbar">
        <h2>刀补连线台 · 在线轨迹</h2>
        <div class="limit-select">
          <span class="muted">条数</span>
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
          <button type="button" class="ghost" onClick={loadPoints} disabled={loading()}>
            {loading() ? "刷新中…" : "刷新"}
          </button>
        </div>
      </div>
      <p class="hint">
        只取已结清（已完成）的点，按提交时间排出并与首页复核列表保持同一顺序；每 3 秒自动刷新在线轨迹。
        圆点＝合格，方块＝超差（形状与文字双重区分，不单靠颜色）。
      </p>

      <TrendChart points={points()} selectedIds={picks().filter((x) => x != null)} />

      <h3 class="block-title">点表对照区（顺序同首页表）</h3>
      <PointTable points={points()} picks={picks()} onPick={onPick} />
      <Show when={!points().length && !loading()}>
        <p class="hint">暂无已结清点</p>
      </Show>

      <div class="action-row">
        <button type="button" onClick={handleCompare} disabled={busy()}>
          {busy() ? "后台计算中…" : "挑两点交后台算差值"}
        </button>
        <Show
          when={canCheckout()}
          fallback={<span class="hint">复核员为只读角色：可查看在线轨迹与已签出副本，仅操作员可签出。</span>}
        >
          <button type="button" class="ghost" onClick={handleCheckout} disabled={busy()}>
            签出只读副本（冻住当前点集{pair() ? "连同差值" : ""}）
          </button>
        </Show>
      </div>

      <DiffPanel pair={pair()} />

      <Show when={notice()}>
        <div class="banner ok">{notice()}</div>
      </Show>

      <h3 class="block-title">已签出区（只读副本，冻结不随后续判定变化）</h3>
      <Show when={snapshots().length} fallback={<p class="hint">尚无签出副本</p>}>
        <table class="snapshot-table">
          <thead>
            <tr>
              <th>副本</th>
              <th>条数</th>
              <th>含差值</th>
              <th>签出人</th>
              <th>签出时间</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <For each={snapshots()}>
              {(s) => (
                <tr>
                  <td>#{s.id}</td>
                  <td>近 {s.limit} 次</td>
                  <td>{s.pair ? `${s.pair.abs_diff_um} µm（${s.pair.first_tool_code}→${s.pair.second_tool_code}）` : "未选点"}</td>
                  <td>{s.checked_out_by || "—"}</td>
                  <td>{fmtTime(s.checked_out_at)}</td>
                  <td>
                    <a class="link-btn" href={`#/snapshot/${s.id}`}>
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

export function SnapshotView(props) {
  const [snap, setSnap] = createSignal(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal("");

  // 副本只取一次：页面停留期间不轮询，永远停在签出版
  createEffect(() => {
    let alive = true;
    setLoading(true);
    fetchSnapshot(props.id)
      .then((data) => alive && setSnap(data))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    onCleanup(() => {
      alive = false;
    });
  });

  const picks = createMemo(() => {
    const p = snap()?.pair;
    return p ? [p.first_id, p.second_id] : [null, null];
  });

  return (
    <section class="card snapshot-view">
      <div class="toolbar">
        <h2>签出只读副本</h2>
        <a class="link-btn" href="#/trend">
          返回连线台
        </a>
      </div>
      <Show when={error()}>
        <div class="banner error">{error()}</div>
      </Show>
      <Show when={loading()}>
        <p class="hint">加载中…</p>
      </Show>
      <Show when={snap() && !loading()}>
        {(s) => (
          <>
            <div class="freeze-banner">
              🔒 副本 #{s().id} 已冻结于 {fmtTime(s().checked_out_at)}，签出人：
              {s().checked_out_by || "—"}，条数：近 {s().limit} 次。此后新判定/新投笔只更新在线轨迹，本副本保持不动。
            </div>
            <TrendChart points={s().points} selectedIds={picks().filter((x) => x != null)} />
            <h3 class="block-title">冻结点表（顺序同签出时首页表）</h3>
            <PointTable points={s().points} picks={picks()} readonly />
            <h3 class="block-title">冻结差值（后台计算结果）</h3>
            <Show when={s().pair} fallback={<p class="hint">签出时未挑选两点，副本不含差值。</p>}>
              <DiffPanel pair={s().pair} />
            </Show>
          </>
        )}
      </Show>
    </section>
  );
}
