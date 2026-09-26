import { useMemo, useState } from "react";
import type {
  Batch,
  BatchEventKind,
  BoardState,
  Tank,
  Water,
} from "./types";
import {
  checkTankForBatch,
  displayReady,
  evaluateWaiting,
  residentWarnings,
  tankOccupied,
  tankResidents,
} from "./engine";
import type { Flash } from "./useBoard";

const eventLabels: Record<BatchEventKind, string> = {
  admit: "登记待入",
  place: "入检疫缸",
  move: "中途换缸",
  abnormal: "标记异常",
  recover: "异常解除",
  complete: "转展示缸",
};

function formatWater(water?: Water | null): string {
  if (!water) return "—";
  return `${water.tempC}℃ / ${water.salinity}‰`;
}

function progress(batch: Batch): number {
  return Math.min(100, Math.round((batch.daysObserved / batch.observeDays) * 100));
}

// ---------- 顶部统计 ----------

export function StatCards({ state }: { state: BoardState }) {
  const waiting = state.batches.filter((b) => b.status === "waiting").length;
  const observing = state.batches.filter((b) => b.status === "quarantined").length;
  const residueTanks = state.tanks.filter((t) => t.residue).length;
  const stats = [
    { label: "当前营业日", value: `第 ${state.day} 天`, tone: "" },
    { label: "待入区鱼批", value: String(waiting), tone: waiting > 0 ? "watch" : "" },
    { label: "检疫观察中鱼批", value: String(observing), tone: "primary" },
    { label: "药水残留缸位", value: String(residueTanks), tone: residueTanks > 0 ? "danger" : "" },
    { label: "已完成记录", value: String(state.completions.length), tone: "ok" },
  ];
  return (
    <section className="metrics-grid">
      {stats.map((s) => (
        <article key={s.label} className={`metric-card tone-${s.tone}`}>
          <span>{s.label}</span>
          <strong>{s.value}</strong>
        </article>
      ))}
    </section>
  );
}

// ---------- 缸位卡 ----------

function WaterEditor({
  tank,
  onSave,
  onClearResidue,
}: {
  tank: Tank;
  onSave: (tempC: number, salinity: number) => void;
  onClearResidue: () => void;
}) {
  const [tempC, setTempC] = useState(tank.water.tempC);
  const [salinity, setSalinity] = useState(tank.water.salinity);
  return (
    <div className="water-editor">
      <label>
        水温 ℃
        <input
          type="number"
          step="0.1"
          value={tempC}
          onChange={(e) => setTempC(Number(e.target.value))}
        />
      </label>
      <label>
        盐度 ‰
        <input
          type="number"
          step="0.1"
          value={salinity}
          onChange={(e) => setSalinity(Number(e.target.value))}
        />
      </label>
      <button
        onClick={() => onSave(tempC, salinity)}
        disabled={tempC === tank.water.tempC && salinity === tank.water.salinity}
      >
        调水并核对
      </button>
      {tank.residue && (
        <button className="danger-action" onClick={onClearResidue}>
          清洗·清残留
        </button>
      )}
    </div>
  );
}

export function TankCard({
  state,
  tank,
  onSaveWater,
  onClearResidue,
}: {
  state: BoardState;
  tank: Tank;
  onSaveWater: (tankId: string, tempC: number, salinity: number) => void;
  onClearResidue: (tankId: string) => void;
}) {
  const occupied = tankOccupied(tank, state.batches);
  const residents = tankResidents(tank, state.batches);
  const full = occupied >= tank.capacity;
  const warnings = residentWarnings(state, tank);

  return (
    <article className={`tank-card ${full ? "is-full" : ""}`}>
      <header className="tank-head">
        <div>
          <h3>{tank.id} <span className="tank-name">{tank.name}</span></h3>
          <span className={`tag tag-${tank.kind}`}>
            {tank.kind === "quarantine" ? "检疫缸" : "展示缸"}
          </span>
          {tank.residue && <span className="tag tag-danger">药水残留</span>}
          {warnings.length > 0 && <span className="tag tag-warn">原缸鱼不耐受</span>}
        </div>
        <div className={`tank-load ${full ? "load-full" : ""}`}>
          <strong>{occupied}</strong>/{tank.capacity}
          <span>尾（水量 {tank.waterVolumeL}L）</span>
        </div>
      </header>

      <div className="water-line">
        当前水质：<b>{formatWater(tank.water)}</b>
      </div>

      {warnings.length > 0 && (
        <ul className="warn-list">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      {residents.length > 0 && (
        <div className="resident-list">
          {residents.map((r) => (
            <span key={r.id} className="resident-chip">
              {r.id} {r.species} ×{r.quantity}
              {r.status === "completed" ? "（展示）" : r.abnormal ? "（异常）" : ""}
            </span>
          ))}
        </div>
      )}

      <WaterEditor
        tank={tank}
        onSave={(t, s) => onSaveWater(tank.id, t, s)}
        onClearResidue={() => onClearResidue(tank.id)}
      />
    </article>
  );
}

// ---------- 待入区 ----------

function WaitingReasons({
  state,
  batch,
}: {
  state: BoardState;
  batch: Batch;
}) {
  // 实时按当前缸位状态重算，避免调水/清残留后展示旧原因
  const evaluation = evaluateWaiting(state, batch);
  return (
    <div className="reasons">
      <p className="reasons-title">排位核对（按每个检疫缸逐项检查）：</p>
      {evaluation.perTank.map((r) => (
        <div key={r.tankId} className="reason-block">
          <div className="reason-head">
            <b>{r.tankId}</b>
            {r.reasons.length === 0 ? (
              <span className="pass">✓ 空间、水质、残留、原缸鱼耐受全部通过</span>
            ) : (
              <span className="fail">{r.reasons.length} 项不满足，留待入区</span>
            )}
          </div>
          {r.reasons.length > 0 && (
            <ul>
              {r.reasons.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

export function WaitingCard({
  state,
  batch,
  onAutoPlace,
  onTryPlace,
}: {
  state: BoardState;
  batch: Batch;
  onAutoPlace: (batchId: string) => void;
  onTryPlace: (batchId: string, tankId: string) => void;
}) {
  const evaluation = evaluateWaiting(state, batch);
  return (
    <article className="batch-card waiting-card">
      <header className="batch-head">
        <div>
          <h3>{batch.id} {batch.species} <span className="muted">×{batch.quantity}</span></h3>
          <p className="muted">
            适温 {batch.tempRange.min}~{batch.tempRange.max}℃ · 适盐{" "}
            {batch.salinityRange.min}~{batch.salinityRange.max}‰ · 观察 {batch.observeDays} 天
          </p>
        </div>
        <button className="primary-action" onClick={() => onAutoPlace(batch.id)}>
          自动排位
        </button>
      </header>
      <WaitingReasons state={state} batch={batch} />
      <div className="place-row">
        <span>指定入缸：</span>
        {evaluation.perTank.map((r) => (
          <button
            key={r.tankId}
            disabled={r.reasons.length > 0}
            title={r.reasons.join("；")}
            onClick={() => onTryPlace(batch.id, r.tankId)}
          >
            {r.tankId}
          </button>
        ))}
      </div>
    </article>
  );
}

// ---------- 检疫观察卡 ----------

function BatchTimeline({ batch }: { batch: Batch }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="timeline">
      <button className="link-btn" onClick={() => setOpen((v) => !v)}>
        {open ? "收起" : "查看"}流转记录（{batch.events.length}）
      </button>
      {open && (
        <ul>
          {batch.events.map((e, i) => (
            <li key={i}>
              <span className="day-mark">第{e.day}天</span>
              <b>{eventLabels[e.kind]}</b>
              {e.fromTankId || e.toTankId
                ? ` ${e.fromTankId ?? "待入区"} → ${e.toTankId ?? "—"}`
                : ""}
              {e.water ? `｜水质 ${formatWater(e.water)}` : ""}
              {e.note ? `｜${e.note}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function QuarantineCard({
  state,
  batch,
  onAdvance,
  onMarkAbnormal,
  onClearAbnormal,
  onMove,
  onTransfer,
}: {
  state: BoardState;
  batch: Batch;
  onAdvance: () => void;
  onMarkAbnormal: (batchId: string) => void;
  onClearAbnormal: (batchId: string) => void;
  onMove: (batchId: string, tankId: string) => void;
  onTransfer: (batchId: string, tankId: string) => void;
}) {
  const tank = state.tanks.find((t) => t.id === batch.tankId);
  const ready = displayReady(batch);
  const displayTanks = state.tanks.filter((t) => t.kind === "display");
  const otherQTanks = state.tanks.filter(
    (t) => t.kind === "quarantine" && t.id !== batch.tankId
  );
  const displayChecks = useMemo(
    () =>
      displayTanks.map((t) => ({
        tank: t,
        reasons: ready.length === 0 ? checkTankForBatch(state, t, batch) : ["先满足转缸前置条件"],
      })),
    [state, batch, ready, displayTanks]
  );

  return (
    <article className={`batch-card quarantine-card ${batch.abnormal ? "is-abnormal" : ""}`}>
      <header className="batch-head">
        <div>
          <h3>
            {batch.id} {batch.species} <span className="muted">×{batch.quantity}</span>
            {batch.abnormal && <span className="tag tag-danger">异常</span>}
            {ready.length === 0 && <span className="tag tag-ok">可转展示缸</span>}
          </h3>
          <p className="muted">
            在缸 <b>{batch.tankId}</b> · 适温 {batch.tempRange.min}~{batch.tempRange.max}℃ ·
            适盐 {batch.salinityRange.min}~{batch.salinityRange.max}‰
          </p>
        </div>
        <button onClick={onAdvance}>快进一天（看它的进度）</button>
      </header>

      <div className="progress-line">
        <div className="progress-bar">
          <i style={{ width: `${progress(batch)}%` }} />
        </div>
        <span>
          观察 {batch.daysObserved}/{batch.observeDays} 天
          {batch.abnormal ? "（异常期间不计天数）" : ""}
        </span>
      </div>

      {ready.length > 0 && (
        <ul className="block-list">
          {ready.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}

      <div className="action-row">
        {!batch.abnormal ? (
          <button className="danger-action" onClick={() => onMarkAbnormal(batch.id)}>
            标记异常
          </button>
        ) : (
          <button className="primary-action" onClick={() => onClearAbnormal(batch.id)}>
            异常解除（观察重新计）
          </button>
        )}

        <label className="inline-select">
          中途换缸（整批）：
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) onMove(batch.id, e.target.value);
              e.currentTarget.value = "";
            }}
          >
            <option value="">选择检疫缸…</option>
            {otherQTanks.map((t) => {
              const reasons = checkTankForBatch(state, t, batch, {
                requireQuarantine: true,
              });
              return (
                <option key={t.id} value={t.id} disabled={reasons.length > 0}>
                  {t.id}
                  {reasons.length > 0 ? `（${reasons[0]}）` : "（核对通过）"}
                </option>
              );
            })}
          </select>
        </label>

        <label className="inline-select">
          转展示缸：
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) onTransfer(batch.id, e.target.value);
              e.currentTarget.value = "";
            }}
          >
            <option value="">选择展示缸…</option>
            {displayChecks.map(({ tank: t, reasons }) => (
              <option key={t.id} value={t.id} disabled={reasons.length > 0}>
                {t.id}
                {reasons.length > 0 ? `（${reasons[0]}）` : "（水质空间核对通过）"}
              </option>
            ))}
          </select>
        </label>
      </div>

      {tank && (
        <p className="muted small">
          {batch.tankId} 当前水质 {formatWater(tank.water)}，占用{" "}
          {tankOccupied(tank, state.batches)}/{tank.capacity} 尾
        </p>
      )}

      <BatchTimeline batch={batch} />
    </article>
  );
}

// ---------- 完成记录 ----------

export function CompletionsPanel({ state }: { state: BoardState }) {
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>留痕</p>
          <h2>已完成记录（留缸号和水质）</h2>
        </div>
      </div>
      {state.completions.length === 0 ? (
        <p className="muted">暂无完成记录。观察期满且无异常的鱼批转展示缸后，会在此留档。</p>
      ) : (
        <div className="table-wrap">
          <table className="record-table">
            <thead>
              <tr>
                <th>鱼批</th>
                <th>品种/数量</th>
                <th>检疫缸号</th>
                <th>展示缸号</th>
                <th>实际观察</th>
                <th>转缸日水质</th>
                <th>完成日</th>
              </tr>
            </thead>
            <tbody>
              {state.completions.map((c) => (
                <tr key={c.batchId}>
                  <td>{c.batchId}</td>
                  <td>{c.species} ×{c.quantity}</td>
                  <td>{c.quarantineTankId ?? "—"}</td>
                  <td>{c.displayTankId}</td>
                  <td>{c.observedDays} 天</td>
                  <td>{formatWater(c.water)}</td>
                  <td>第 {c.day} 天</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------- 提示条 ----------

export function FlashBar({ flash }: { flash: Flash | null }) {
  if (!flash) return null;
  return <div className={`flash flash-${flash.type}`}>{flash.text}</div>;
}
