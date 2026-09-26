import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import "./styles.css";
import {
  KIND_LABEL,
  addDays,
  batchFitsWater,
  checkTankForBatch,
  daysBetween,
  nextBatchId,
  occupancyOf,
  residentsOf,
  seedState,
} from "./domain";
import type { Batch, QueueState, Tank, TankKind } from "./domain";

const STORAGE_KEY = "hxwl05-queue-v1";

function loadState(): QueueState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as QueueState;
      if (
        parsed &&
        typeof parsed.today === "string" &&
        Array.isArray(parsed.tanks) &&
        Array.isArray(parsed.batches)
      ) {
        return parsed;
      }
    }
  } catch {
    // 数据损坏时回退到示例数据
  }
  return seedState();
}

const num = (v: string): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const statusColors = ["status-ok", "status-watch", "status-danger"];

function MetricCard({ label, value, index }: { label: string; value: string; index: number }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <i className={statusColors[index % statusColors.length]} />
    </article>
  );
}

function TankCard({
  tank,
  batches,
  onPatch,
  onRemove,
}: {
  tank: Tank;
  batches: Batch[];
  onPatch: (id: string, patch: Partial<Tank>) => void;
  onRemove: (id: string) => void;
}) {
  const used = occupancyOf(tank.id, batches);
  const residents = residentsOf(tank.id, batches);
  const pct = tank.capacity > 0 ? Math.min(100, Math.round((used / tank.capacity) * 100)) : 0;
  const intolerant = residents.filter((r) => !batchFitsWater(r, tank.temperature, tank.salinity));

  return (
    <article className="tank-card">
      <header>
        <strong>{tank.id}</strong>
        <span className={`badge ${tank.kind}`}>{KIND_LABEL[tank.kind]}</span>
        {tank.medicated && <span className="badge danger">有药残</span>}
      </header>
      <div className="tank-params">
        <label>
          温度（℃）
          <input
            type="number"
            step="0.5"
            value={tank.temperature}
            onChange={(e) => onPatch(tank.id, { temperature: num(e.target.value) })}
          />
        </label>
        <label>
          盐度（‰）
          <input
            type="number"
            step="0.5"
            value={tank.salinity}
            onChange={(e) => onPatch(tank.id, { salinity: num(e.target.value) })}
          />
        </label>
        <label>
          水量（L）
          <input
            type="number"
            value={tank.waterVolume}
            onChange={(e) => onPatch(tank.id, { waterVolume: num(e.target.value) })}
          />
        </label>
        <label>
          缸容（尾）
          <input
            type="number"
            value={tank.capacity}
            onChange={(e) => onPatch(tank.id, { capacity: Math.max(0, Math.round(num(e.target.value))) })}
          />
        </label>
      </div>
      <div className="occupancy">
        <div className="bar">
          <i style={{ width: pct + "%" }} />
        </div>
        <span>
          占用 {used}/{tank.capacity} 尾
        </span>
      </div>
      {intolerant.length > 0 && (
        <p className="warn-text">⚠ {intolerant.map((r) => r.species).join("、")} 不适应当前水质</p>
      )}
      <div className="chips">
        {residents.length === 0 ? (
          <span>空缸</span>
        ) : (
          residents.map((r) => (
            <span key={r.id}>
              {r.id} {r.species} ×{r.quantity}
            </span>
          ))
        )}
      </div>
      <footer>
        <button onClick={() => onPatch(tank.id, { medicated: !tank.medicated })}>
          {tank.medicated ? "洗缸完成（清药残）" : "标记用药"}
        </button>
        {residents.length === 0 && <button onClick={() => onRemove(tank.id)}>删除缸位</button>}
      </footer>
    </article>
  );
}

function WaitingCard({
  batch,
  tanks,
  batches,
  onAssign,
  onRemove,
}: {
  batch: Batch;
  tanks: Tank[];
  batches: Batch[];
  onAssign: (batchId: string, target: string) => void;
  onRemove: (batchId: string) => void;
}) {
  const [target, setTarget] = useState("auto");
  const quarantineTanks = tanks.filter((t) => t.kind === "quarantine");

  return (
    <article className="batch-card">
      <div className="batch-head">
        <strong>
          {batch.id} · {batch.species} ×{batch.quantity}尾
        </strong>
        <span className="badge waiting">待入区</span>
      </div>
      <p className="batch-meta">
        适温 {batch.tempMin}–{batch.tempMax}℃ · 适盐 {batch.salMin}–{batch.salMax}‰ · 观察{" "}
        {batch.observeDays} 天
      </p>
      {batch.stayReason && <p className="reason">{batch.stayReason}</p>}
      <div className="batch-actions">
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="auto">自动匹配检疫缸</option>
          {quarantineTanks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.id} · {t.temperature}℃ · 盐{t.salinity}‰ · 余
              {t.capacity - occupancyOf(t.id, batches)}尾{t.medicated ? " · 有药残" : ""}
            </option>
          ))}
        </select>
        <button className="primary-action" onClick={() => onAssign(batch.id, target)}>
          排位入缸
        </button>
        <button onClick={() => onRemove(batch.id)}>撤批</button>
      </div>
    </article>
  );
}

function QuarantineCard({
  batch,
  tanks,
  today,
  onTransfer,
  onMove,
  onToggleAbnormal,
  onNote,
}: {
  batch: Batch;
  tanks: Tank[];
  today: string;
  onTransfer: (batchId: string) => void;
  onMove: (batchId: string, targetId: string) => void;
  onToggleAbnormal: (batchId: string) => void;
  onNote: (batchId: string, note: string) => void;
}) {
  const [target, setTarget] = useState("");
  const observed = batch.enteredAt ? daysBetween(batch.enteredAt, today) : 0;
  const ready = !batch.abnormal && observed >= batch.observeDays;
  const pct = Math.min(100, Math.round((observed / Math.max(batch.observeDays, 1)) * 100));
  const moveTargets = tanks.filter((t) => t.kind === "quarantine" && t.id !== batch.currentTankId);

  return (
    <article className="batch-card">
      <div className="batch-head">
        <strong>
          {batch.id} · {batch.species} ×{batch.quantity}尾
        </strong>
        <span className="badge quarantine">检疫中 · {batch.currentTankId}</span>
        {batch.abnormal && <span className="badge danger">异常</span>}
      </div>
      <p className="batch-meta">
        适温 {batch.tempMin}–{batch.tempMax}℃ · 适盐 {batch.salMin}–{batch.salMax}‰ · 已观察{" "}
        {observed}/{batch.observeDays} 天
      </p>
      <div className="occupancy">
        <div className="bar">
          <i style={{ width: pct + "%" }} />
        </div>
        <span>{ready ? "观察期满，可转展示缸" : `还需 ${batch.observeDays - observed} 天`}</span>
      </div>
      {batch.abnormal && (
        <label className="note-line">
          <span>异常记录</span>
          <input value={batch.abnormalNote} onChange={(e) => onNote(batch.id, e.target.value)} />
        </label>
      )}
      {batch.stayReason && <p className="reason">{batch.stayReason}</p>}
      <div className="batch-actions">
        <button className="primary-action" disabled={!ready} onClick={() => onTransfer(batch.id)}>
          转展示缸{batch.abnormal ? "（有异常）" : ready ? "" : "（未满期）"}
        </button>
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">选择换缸目标…</option>
          {moveTargets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.id} · {t.temperature}℃ · 盐{t.salinity}‰{t.medicated ? " · 有药残" : ""}
            </option>
          ))}
        </select>
        <button disabled={!target} onClick={() => onMove(batch.id, target)}>
          整批换缸
        </button>
        <button onClick={() => onToggleAbnormal(batch.id)}>
          {batch.abnormal ? "解除异常" : "标记异常"}
        </button>
      </div>
    </article>
  );
}

interface TankForm {
  id: string;
  kind: TankKind;
  waterVolume: string;
  temperature: string;
  salinity: string;
  capacity: string;
  medicated: boolean;
}

const emptyTankForm: TankForm = {
  id: "",
  kind: "quarantine",
  waterVolume: "",
  temperature: "",
  salinity: "",
  capacity: "",
  medicated: false,
};

interface BatchForm {
  species: string;
  quantity: string;
  tempMin: string;
  tempMax: string;
  salMin: string;
  salMax: string;
  observeDays: string;
}

const emptyBatchForm: BatchForm = {
  species: "",
  quantity: "",
  tempMin: "",
  tempMax: "",
  salMin: "",
  salMax: "",
  observeDays: "7",
};

function App() {
  const [state, setState] = useState<QueueState>(loadState);
  const [tankForm, setTankForm] = useState<TankForm>(emptyTankForm);
  const [tankErr, setTankErr] = useState("");
  const [batchForm, setBatchForm] = useState<BatchForm>(emptyBatchForm);
  const [batchErr, setBatchErr] = useState("");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const { today, tanks, batches } = state;
  const waiting = batches.filter((b) => b.status === "waiting");
  const quarantining = batches.filter((b) => b.status === "quarantine");
  const done = batches.filter((b) => b.status === "done");
  const quarantineTanks = tanks.filter((t) => t.kind === "quarantine");
  const qCap = quarantineTanks.reduce((s, t) => s + t.capacity, 0);
  const qUsed = quarantineTanks.reduce((s, t) => s + occupancyOf(t.id, batches), 0);
  const readyToMove = quarantining.filter(
    (b) => !b.abnormal && b.enteredAt !== null && daysBetween(b.enteredAt, today) >= b.observeDays
  ).length;

  const patchBatch = (id: string, patch: Partial<Batch>) =>
    setState((s) => ({
      ...s,
      batches: s.batches.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    }));

  const patchTank = (id: string, patch: Partial<Tank>) =>
    setState((s) => ({
      ...s,
      tanks: s.tanks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));

  /** 入缸：占用目标缸位，履历记录入缸水质快照 */
  const enterTank = (batchId: string, tank: Tank) =>
    setState((s) => ({
      ...s,
      batches: s.batches.map((b) =>
        b.id === batchId
          ? {
              ...b,
              status: "quarantine",
              currentTankId: tank.id,
              enteredAt: s.today,
              stayReason: "",
              history: [
                ...b.history,
                {
                  tankId: tank.id,
                  tankKind: tank.kind,
                  enteredAt: s.today,
                  leftAt: null,
                  temperature: tank.temperature,
                  salinity: tank.salinity,
                  waterVolume: tank.waterVolume,
                },
              ],
            }
          : b
      ),
    }));

  /** 排位：自动或指定检疫缸，核对空间与水质，缺项留在待入区并写明 */
  const assignBatch = (batchId: string, target: string) => {
    const batch = batches.find((b) => b.id === batchId);
    if (!batch || batch.status !== "waiting") return;
    const candidates =
      target === "auto"
        ? quarantineTanks
        : tanks.filter((t) => t.id === target && t.kind === "quarantine");
    if (candidates.length === 0) {
      patchBatch(batchId, {
        stayReason: target === "auto" ? "没有检疫缸位，请先新增检疫缸" : "目标缸位不是检疫缸",
      });
      return;
    }
    let best: { tank: Tank; problems: string[] } | null = null;
    for (const tank of candidates) {
      const problems = checkTankForBatch(tank, batch, batches);
      if (problems.length === 0) {
        enterTank(batchId, tank);
        return;
      }
      if (!best || problems.length < best.problems.length) best = { tank, problems };
    }
    const b = best as { tank: Tank; problems: string[] };
    patchBatch(batchId, {
      stayReason: `缺项待补（最接近 ${b.tank.id}）：${b.problems.join("；")}`,
    });
  };

  /** 转展示缸：须观察期满且无异常，转缸复核对水质，原缸位随占用转移自动释放 */
  const transferBatch = (batchId: string) => {
    const batch = batches.find((b) => b.id === batchId);
    if (!batch || batch.status !== "quarantine" || batch.enteredAt === null) return;
    if (batch.abnormal) {
      patchBatch(batchId, { stayReason: "有异常未解除，暂不能转展示缸" });
      return;
    }
    const observed = daysBetween(batch.enteredAt, today);
    if (observed < batch.observeDays) {
      patchBatch(batchId, {
        stayReason: `观察期未满（${observed}/${batch.observeDays} 天）`,
      });
      return;
    }
    const displayTanks = tanks.filter((t) => t.kind === "display");
    if (displayTanks.length === 0) {
      patchBatch(batchId, { stayReason: "没有展示缸位，请先新增展示缸" });
      return;
    }
    let best: { tank: Tank; problems: string[] } | null = null;
    for (const tank of displayTanks) {
      const problems = checkTankForBatch(tank, batch, batches);
      if (problems.length === 0) {
        setState((s) => ({
          ...s,
          batches: s.batches.map((b) =>
            b.id === batchId
              ? {
                  ...b,
                  status: "done",
                  currentTankId: tank.id,
                  enteredAt: s.today,
                  stayReason: "",
                  abnormal: false,
                  abnormalNote: "",
                  completedAt: s.today,
                  completedTankId: tank.id,
                  completedWater: {
                    temperature: tank.temperature,
                    salinity: tank.salinity,
                    waterVolume: tank.waterVolume,
                  },
                  history: [
                    ...b.history.map((h) => (h.leftAt === null ? { ...h, leftAt: s.today } : h)),
                    {
                      tankId: tank.id,
                      tankKind: tank.kind,
                      enteredAt: s.today,
                      leftAt: null,
                      temperature: tank.temperature,
                      salinity: tank.salinity,
                      waterVolume: tank.waterVolume,
                    },
                  ],
                }
              : b
          ),
        }));
        return;
      }
      if (!best || problems.length < best.problems.length) best = { tank, problems };
    }
    const b = best as { tank: Tank; problems: string[] };
    patchBatch(batchId, {
      stayReason: `转缸未过（最接近 ${b.tank.id}）：${b.problems.join("；")}`,
    });
  };

  /** 中途换缸：整批处理，数量不变，观察期不清零，履历记一笔 */
  const moveBatch = (batchId: string, targetId: string) => {
    const batch = batches.find((b) => b.id === batchId);
    const target = tanks.find((t) => t.id === targetId);
    if (!batch || batch.status !== "quarantine" || !target || target.kind !== "quarantine") return;
    if (target.id === batch.currentTankId) return;
    const problems = checkTankForBatch(target, batch, batches);
    if (problems.length > 0) {
      patchBatch(batchId, {
        stayReason: `换缸未过（${target.id}）：${problems.join("；")}`,
      });
      return;
    }
    setState((s) => ({
      ...s,
      batches: s.batches.map((b) =>
        b.id === batchId
          ? {
              ...b,
              currentTankId: target.id,
              stayReason: "",
              history: [
                ...b.history.map((h) => (h.leftAt === null ? { ...h, leftAt: s.today } : h)),
                {
                  tankId: target.id,
                  tankKind: target.kind,
                  enteredAt: s.today,
                  leftAt: null,
                  temperature: target.temperature,
                  salinity: target.salinity,
                  waterVolume: target.waterVolume,
                },
              ],
            }
          : b
      ),
    }));
  };

  const toggleAbnormal = (batchId: string) => {
    const batch = batches.find((b) => b.id === batchId);
    if (!batch) return;
    patchBatch(batchId, {
      abnormal: !batch.abnormal,
      abnormalNote: batch.abnormal ? "" : `发现异常，待复查（${today}）`,
      stayReason: "",
    });
  };

  const submitTank = (e: FormEvent) => {
    e.preventDefault();
    const id = tankForm.id.trim();
    if (!id) return setTankErr("请填写缸号");
    if (tanks.some((t) => t.id === id)) return setTankErr(`缸号 ${id} 已存在`);
    const tank: Tank = {
      id,
      kind: tankForm.kind,
      waterVolume: num(tankForm.waterVolume),
      temperature: num(tankForm.temperature),
      salinity: num(tankForm.salinity),
      capacity: Math.max(0, Math.round(num(tankForm.capacity))),
      medicated: tankForm.medicated,
    };
    setState((s) => ({ ...s, tanks: [...s.tanks, tank] }));
    setTankForm(emptyTankForm);
    setTankErr("");
  };

  const submitBatch = (e: FormEvent) => {
    e.preventDefault();
    const species = batchForm.species.trim();
    if (!species) return setBatchErr("请填写品种");
    const quantity = Math.round(num(batchForm.quantity));
    if (quantity < 1) return setBatchErr("数量至少 1 尾");
    const tempMin = num(batchForm.tempMin);
    const tempMax = num(batchForm.tempMax);
    if (tempMin > tempMax) return setBatchErr("适温下限不能高于上限");
    const salMin = num(batchForm.salMin);
    const salMax = num(batchForm.salMax);
    if (salMin > salMax) return setBatchErr("适盐下限不能高于上限");
    const observeDays = Math.round(num(batchForm.observeDays));
    if (observeDays < 1) return setBatchErr("观察天数至少 1 天");
    const batch: Batch = {
      id: nextBatchId(batches),
      species,
      quantity,
      tempMin,
      tempMax,
      salMin,
      salMax,
      observeDays,
      status: "waiting",
      currentTankId: null,
      enteredAt: null,
      abnormal: false,
      abnormalNote: "",
      stayReason: "新登记，待排位",
      history: [],
      completedAt: null,
      completedTankId: null,
      completedWater: null,
    };
    setState((s) => ({ ...s, batches: [...s.batches, batch] }));
    setBatchForm(emptyBatchForm);
    setBatchErr("");
  };

  const removeTank = (id: string) => {
    if (residentsOf(id, batches).length > 0) return;
    setState((s) => ({ ...s, tanks: s.tanks.filter((t) => t.id !== id) }));
  };

  const removeBatch = (id: string) =>
    setState((s) => ({
      ...s,
      batches: s.batches.filter((b) => !(b.id === id && b.status === "waiting")),
    }));

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-05 · port 5105 · 水族养护</p>
          <h1>入缸排队台</h1>
          <p className="subtitle">
            新鱼登记成鱼批后先排位：核对缸位空间、水温、盐度与药水残留，缺项留在待入区并写明原因。
            入缸即占用缸位，观察期满且无异常才转展示缸，转缸复核对水质并释放原缸位；中途换缸按整批处理。
          </p>
        </div>
        <div className="stack-card">
          <span>营业日期</span>
          <strong>{today}</strong>
          <div className="row">
            <button onClick={() => setState((s) => ({ ...s, today: addDays(s.today, 1) }))}>
              过一天 +1
            </button>
            <button onClick={() => setState(seedState())}>恢复示例</button>
          </div>
          <span>React + Vite + TypeScript</span>
        </div>
      </section>

      <section className="metrics-grid">
        <MetricCard label="待入区批次" value={String(waiting.length)} index={0} />
        <MetricCard label="检疫中批次" value={String(quarantining.length)} index={1} />
        <MetricCard label="检疫缸占用（尾）" value={`${qUsed}/${qCap}`} index={2} />
        <MetricCard label="可转展示缸" value={String(readyToMove)} index={3} />
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>缸位看板</p>
            <h2>缸位与水质</h2>
          </div>
        </div>
        <div className="tank-grid">
          {tanks.map((tank) => (
            <TankCard key={tank.id} tank={tank} batches={batches} onPatch={patchTank} onRemove={removeTank} />
          ))}
        </div>
      </section>

      <section className="workspace">
        <aside>
          <section className="panel narrow">
            <h2>新增缸位</h2>
            <form className="form-grid" onSubmit={submitTank}>
              <label>
                <span>缸号</span>
                <input
                  value={tankForm.id}
                  placeholder="如 Q-04"
                  onChange={(e) => setTankForm({ ...tankForm, id: e.target.value })}
                />
              </label>
              <label>
                <span>类型</span>
                <select
                  value={tankForm.kind}
                  onChange={(e) => setTankForm({ ...tankForm, kind: e.target.value as TankKind })}
                >
                  <option value="quarantine">检疫缸</option>
                  <option value="display">展示缸</option>
                </select>
              </label>
              <label>
                <span>水量（L）</span>
                <input
                  type="number"
                  value={tankForm.waterVolume}
                  onChange={(e) => setTankForm({ ...tankForm, waterVolume: e.target.value })}
                />
              </label>
              <label>
                <span>温度（℃）</span>
                <input
                  type="number"
                  step="0.5"
                  value={tankForm.temperature}
                  onChange={(e) => setTankForm({ ...tankForm, temperature: e.target.value })}
                />
              </label>
              <label>
                <span>盐度（‰）</span>
                <input
                  type="number"
                  step="0.5"
                  value={tankForm.salinity}
                  onChange={(e) => setTankForm({ ...tankForm, salinity: e.target.value })}
                />
              </label>
              <label>
                <span>缸容（尾）</span>
                <input
                  type="number"
                  value={tankForm.capacity}
                  onChange={(e) => setTankForm({ ...tankForm, capacity: e.target.value })}
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={tankForm.medicated}
                  onChange={(e) => setTankForm({ ...tankForm, medicated: e.target.checked })}
                />
                有药水残留
              </label>
              {tankErr && <p className="error-text">{tankErr}</p>}
              <button className="primary-action" type="submit">
                登记缸位
              </button>
            </form>
          </section>

          <section className="panel narrow">
            <h2>新增鱼批</h2>
            <form className="form-grid" onSubmit={submitBatch}>
              <label>
                <span>品种</span>
                <input
                  value={batchForm.species}
                  placeholder="如 孔雀鱼"
                  onChange={(e) => setBatchForm({ ...batchForm, species: e.target.value })}
                />
              </label>
              <label>
                <span>数量（尾）</span>
                <input
                  type="number"
                  value={batchForm.quantity}
                  onChange={(e) => setBatchForm({ ...batchForm, quantity: e.target.value })}
                />
              </label>
              <div className="pair">
                <label>
                  <span>适温低（℃）</span>
                  <input
                    type="number"
                    step="0.5"
                    value={batchForm.tempMin}
                    onChange={(e) => setBatchForm({ ...batchForm, tempMin: e.target.value })}
                  />
                </label>
                <label>
                  <span>适温高（℃）</span>
                  <input
                    type="number"
                    step="0.5"
                    value={batchForm.tempMax}
                    onChange={(e) => setBatchForm({ ...batchForm, tempMax: e.target.value })}
                  />
                </label>
              </div>
              <div className="pair">
                <label>
                  <span>适盐低（‰）</span>
                  <input
                    type="number"
                    step="0.5"
                    value={batchForm.salMin}
                    onChange={(e) => setBatchForm({ ...batchForm, salMin: e.target.value })}
                  />
                </label>
                <label>
                  <span>适盐高（‰）</span>
                  <input
                    type="number"
                    step="0.5"
                    value={batchForm.salMax}
                    onChange={(e) => setBatchForm({ ...batchForm, salMax: e.target.value })}
                  />
                </label>
              </div>
              <label>
                <span>观察天数</span>
                <input
                  type="number"
                  value={batchForm.observeDays}
                  onChange={(e) => setBatchForm({ ...batchForm, observeDays: e.target.value })}
                />
              </label>
              {batchErr && <p className="error-text">{batchErr}</p>}
              <button className="primary-action" type="submit">
                登记鱼批（进待入区）
              </button>
            </form>
          </section>
        </aside>

        <div className="queue-column">
          <section className="panel">
            <div className="section-heading">
              <div>
                <p>待入区</p>
                <h2>待入鱼批（{waiting.length}）</h2>
              </div>
            </div>
            {waiting.length === 0 ? (
              <p className="empty">待入区已清空</p>
            ) : (
              waiting.map((b) => (
                <WaitingCard
                  key={b.id}
                  batch={b}
                  tanks={tanks}
                  batches={batches}
                  onAssign={assignBatch}
                  onRemove={removeBatch}
                />
              ))
            )}
          </section>

          <section className="panel">
            <div className="section-heading">
              <div>
                <p>检疫中</p>
                <h2>观察期鱼批（{quarantining.length}）</h2>
              </div>
            </div>
            {quarantining.length === 0 ? (
              <p className="empty">暂无检疫中的鱼批</p>
            ) : (
              quarantining.map((b) => (
                <QuarantineCard
                  key={b.id}
                  batch={b}
                  tanks={tanks}
                  today={today}
                  onTransfer={transferBatch}
                  onMove={moveBatch}
                  onToggleAbnormal={toggleAbnormal}
                  onNote={(id, note) => patchBatch(id, { abnormalNote: note })}
                />
              ))
            )}
          </section>
        </div>
      </section>

      <section className="records panel">
        <div className="section-heading">
          <div>
            <p>已完成</p>
            <h2>已转展示缸记录（{done.length}）</h2>
          </div>
        </div>
        <div className="record-list">
          {done.length === 0 ? (
            <p className="empty">暂无完成记录</p>
          ) : (
            done.map((b) => (
              <article key={b.id} className="record-card">
                <div className="record-index">{b.id}</div>
                <div>
                  <h3>
                    {b.species} ×{b.quantity}尾 → {b.completedTankId}（展示缸）
                  </h3>
                  <p>
                    入缸水质：{b.completedWater?.temperature}℃ · 盐度 {b.completedWater?.salinity}‰ ·
                    水量 {b.completedWater?.waterVolume}L · 完成于 {b.completedAt}
                  </p>
                  <p>
                    路径：
                    {b.history
                      .map(
                        (h) =>
                          `${h.tankId}（${KIND_LABEL[h.tankKind]}，${h.enteredAt} 入${
                            h.leftAt ? `，${h.leftAt} 出` : "，在缸"
                          }）`
                      )
                      .join(" → ")}
                  </p>
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );
}

export default App;
