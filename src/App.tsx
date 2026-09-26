import { useState } from "react";
import "./styles.css";
import { useBoard } from "./queue/useBoard";
import {
  addTank,
  admitBatch,
  advanceDay,
  autoPlace,
  attemptPlace,
  clearAbnormal,
  markAbnormal,
  moveBatch,
  transferToDisplay,
} from "./queue/engine";
import type { TankKind } from "./queue/types";
import {
  CompletionsPanel,
  FlashBar,
  QuarantineCard,
  StatCards,
  TankCard,
  WaitingCard,
} from "./queue/components";

function AddTankForm({
  onAdd,
}: {
  onAdd: (input: {
    id: string;
    kind: TankKind;
    waterVolumeL: number;
    capacity: number;
    tempC: number;
    salinity: number;
    residue: boolean;
  }) => void;
}) {
  const [id, setId] = useState("");
  const [kind, setKind] = useState<TankKind>("quarantine");
  const [waterVolumeL, setVolume] = useState(100);
  const [capacity, setCapacity] = useState(20);
  const [tempC, setTemp] = useState(25.5);
  const [salinity, setSalinity] = useState(35);
  const [residue, setResidue] = useState(false);

  return (
    <form
      className="entry-form"
      onSubmit={(e) => {
        e.preventDefault();
        onAdd({ id, kind, waterVolumeL, capacity, tempC, salinity, residue });
        setId("");
      }}
    >
      <h3>新增缸位</h3>
      <p className="muted small">登记水量、温度、盐度、缸容；有药水残留先勾选。</p>
      <div className="field-grid">
        <label>
          <span>缸号</span>
          <input value={id} onChange={(e) => setId(e.target.value)} placeholder="如 Q4 / D2" required />
        </label>
        <label>
          <span>缸位类型</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as TankKind)}>
            <option value="quarantine">检疫缸</option>
            <option value="display">展示缸</option>
          </select>
        </label>
        <label>
          <span>水量（L）</span>
          <input type="number" min="1" value={waterVolumeL} onChange={(e) => setVolume(Number(e.target.value))} />
        </label>
        <label>
          <span>缸容（尾）</span>
          <input type="number" min="1" value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} />
        </label>
        <label>
          <span>当前水温 ℃</span>
          <input type="number" step="0.1" value={tempC} onChange={(e) => setTemp(Number(e.target.value))} />
        </label>
        <label>
          <span>当前盐度 ‰</span>
          <input type="number" step="0.1" value={salinity} onChange={(e) => setSalinity(Number(e.target.value))} />
        </label>
      </div>
      <label className="checkbox-line">
        <input type="checkbox" checked={residue} onChange={(e) => setResidue(e.target.checked)} />
        缸内有药水残留（清洗前不可并缸）
      </label>
      <button className="primary-action" type="submit">登记缸位</button>
    </form>
  );
}

function AdmitBatchForm({
  onAdmit,
}: {
  onAdmit: (input: {
    species: string;
    quantity: number;
    tempMin: number;
    tempMax: number;
    salinityMin: number;
    salinityMax: number;
    observeDays: number;
  }) => void;
}) {
  const [species, setSpecies] = useState("");
  const [quantity, setQuantity] = useState(2);
  const [tempMin, setTempMin] = useState(24);
  const [tempMax, setTempMax] = useState(27);
  const [salinityMin, setSalinityMin] = useState(32);
  const [salinityMax, setSalinityMax] = useState(36);
  const [observeDays, setObserveDays] = useState(7);

  return (
    <form
      className="entry-form"
      onSubmit={(e) => {
        e.preventDefault();
        onAdmit({
          species,
          quantity,
          tempMin,
          tempMax,
          salinityMin,
          salinityMax,
          observeDays,
        });
        setSpecies("");
      }}
    >
      <h3>登记新鱼批（先进待入区）</h3>
      <p className="muted small">记录品种、数量、适温/适盐区间和观察天数，整批处理不拆分。</p>
      <div className="field-grid">
        <label>
          <span>品种</span>
          <input value={species} onChange={(e) => setSpecies(e.target.value)} placeholder="如 公子小丑鱼" required />
        </label>
        <label>
          <span>数量（尾）</span>
          <input type="number" min="1" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
        </label>
        <label>
          <span>适温下限 ℃</span>
          <input type="number" step="0.1" value={tempMin} onChange={(e) => setTempMin(Number(e.target.value))} />
        </label>
        <label>
          <span>适温上限 ℃</span>
          <input type="number" step="0.1" value={tempMax} onChange={(e) => setTempMax(Number(e.target.value))} />
        </label>
        <label>
          <span>适盐下限 ‰</span>
          <input type="number" step="0.1" value={salinityMin} onChange={(e) => setSalinityMin(Number(e.target.value))} />
        </label>
        <label>
          <span>适盐上限 ‰</span>
          <input type="number" step="0.1" value={salinityMax} onChange={(e) => setSalinityMax(Number(e.target.value))} />
        </label>
        <label>
          <span>观察天数</span>
          <input type="number" min="1" value={observeDays} onChange={(e) => setObserveDays(Number(e.target.value))} />
        </label>
      </div>
      <button className="primary-action" type="submit">登记并排位检查</button>
    </form>
  );
}

function App() {
  const board = useBoard();
  const { state, apply, applyPlace, applyWater, applyClearResidue } = board;

  const waiting = state.batches.filter((b) => b.status === "waiting");
  const quarantined = state.batches.filter((b) => b.status === "quarantined");
  const quarantineTanks = state.tanks.filter((t) => t.kind === "quarantine");
  const displayTanks = state.tanks.filter((t) => t.kind === "display");

  return (
    <main className="app-shell">
      <FlashBar flash={board.flash} />

      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-05 · 入缸排队台 · port 5105</p>
          <h1>新鱼入缸排队台</h1>
          <p className="subtitle">
            不只看当前水温：排位同时核清缸位空间、检疫缸是否可用、药水残留、当前水温盐度是否在适区，
            以及原缸鱼耐受。缺项留在待入区并逐项写明；观察期满且无异常才转展示缸，转缸再核对水质并释放检疫缸位。
          </p>
        </div>
        <div className="stack-card">
          <span>营业日</span>
          <strong>第 {state.day} 天</strong>
          <button onClick={() => apply((s) => advanceDay(s), "已快进一天：观察中的无异常鱼批各累计 1 天观察")}>
            快进一天
          </button>
          <button onClick={() => {
            if (window.confirm("重置为示例数据？当前记录会被清除。")) board.reset();
          }}>
            重置示例数据
          </button>
        </div>
      </section>

      <StatCards state={state} />

      <section className="board-grid">
        <div className="board-col">
          <section className="panel">
            <div className="section-heading">
              <div>
                <p>待入区</p>
                <h2>排队待入（{waiting.length}）</h2>
              </div>
            </div>
            {waiting.length === 0 ? (
              <p className="muted">待入区为空，新登记的鱼批会先到这里排队核对。</p>
            ) : (
              <div className="card-stack">
                {waiting.map((b) => (
                  <WaitingCard
                    key={b.id}
                    state={state}
                    batch={b}
                    onAutoPlace={(id) => applyPlace((s) => autoPlace(s, id))}
                    onTryPlace={(id, tankId) => applyPlace((s) => attemptPlace(s, id, tankId))}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <div className="section-heading">
              <div>
                <p>检疫观察</p>
                <h2>检疫缸鱼批（{quarantined.length}）</h2>
              </div>
            </div>
            {quarantined.length === 0 ? (
              <p className="muted">检疫缸暂无观察中的鱼批。</p>
            ) : (
              <div className="card-stack">
                {quarantined.map((b) => (
                  <QuarantineCard
                    key={b.id}
                    state={state}
                    batch={b}
                    onAdvance={() =>
                      apply((s) => advanceDay(s), `已推进 1 天：${b.id} 观察 ${Math.min(b.daysObserved + 1, b.observeDays)}/${b.observeDays} 天`)
                    }
                    onMarkAbnormal={(id) => apply((s) => markAbnormal(s, id), `${id} 已标记异常，观察天数暂停累计`)}
                    onClearAbnormal={(id) => apply((s) => clearAbnormal(s, id), `${id} 异常解除，观察天数重新计`)}
                    onMove={(id, tankId) => apply((s) => moveBatch(s, id, tankId), `${id} 已整批换入 ${tankId}，原缸位占用已释放`)}
                    onTransfer={(id, tankId) =>
                      apply((s) => transferToDisplay(s, id, tankId), `${id} 已转展示缸 ${tankId}，检疫缸位已释放并留档`)
                    }
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="board-col">
          <section className="panel">
            <div className="section-heading">
              <div>
                <p>缸位状态</p>
                <h2>检疫缸（{quarantineTanks.length}）</h2>
              </div>
            </div>
            <div className="card-stack">
              {quarantineTanks.map((t) => (
                <TankCard
                  key={t.id}
                  state={state}
                  tank={t}
                  onSaveWater={applyWater}
                  onClearResidue={applyClearResidue}
                />
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="section-heading">
              <div>
                <p>缸位状态</p>
                <h2>展示缸（{displayTanks.length}）</h2>
              </div>
            </div>
            <div className="card-stack">
              {displayTanks.map((t) => (
                <TankCard
                  key={t.id}
                  state={state}
                  tank={t}
                  onSaveWater={applyWater}
                  onClearResidue={applyClearResidue}
                />
              ))}
            </div>
          </section>
        </div>
      </section>

      <CompletionsPanel state={state} />

      <section className="workspace">
        <section className="panel">
          <AddTankForm onAdd={(input) => apply((s) => addTank(s, input), `缸位 ${input.id} 已登记`)} />
        </section>
        <section className="panel">
          <AdmitBatchForm onAdmit={(input) => apply((s) => admitBatch(s, input), "新鱼批已登记并进入待入区，已完成排位核对")} />
        </section>
      </section>
    </main>
  );
}

export default App;
