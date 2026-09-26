import type {
  AddTankInput,
  AdmitBatchInput,
  Batch,
  BatchEvent,
  BoardState,
  CompletionRecord,
  Range,
  Tank,
  WaitReasons,
  Water,
} from "./types";

/**
 * 入缸排队台规则引擎
 *
 * 排位必须同时核清：
 * 1. 空间：缸容 - 在缸鱼只数，够放下整批数量
 * 2. 检疫缸空不空：只有检疫缸可接收待入/观察中的鱼批
 * 3. 药水残留：缸内有残留一律先清洗，不能并缸
 * 4. 水温 / 盐度：当前水质落在该批适温、适盐区间内
 * 5. 原缸鱼耐受：调水后水质仍要满足缸内所有原住鱼批的区间
 *
 * 缺哪项就留在待入区，并按缸逐项写明原因。
 */

const inRange = (value: number, range: Range): boolean =>
  value >= range.min && value <= range.max;

export class RuleError extends Error {}

// ---------- 派生信息 ----------

export function tankOccupied(tank: Tank, batches: Batch[]): number {
  return tank.batchIds.reduce(
    (sum, id) => sum + (batches.find((b) => b.id === id)?.quantity ?? 0),
    0
  );
}

export function tankResidents(tank: Tank, batches: Batch[]): Batch[] {
  return tank.batchIds
    .map((id) => batches.find((b) => b.id === id))
    .filter((b): b is Batch => Boolean(b));
}

/**
 * 检查某个缸位能否接收指定鱼批，返回不满足项（空数组 = 可以入缸）。
 * 该检查同时服务：待入排位、中途换缸、转展示缸。
 */
export function checkTankForBatch(
  state: BoardState,
  tank: Tank,
  batch: Batch,
  options: { requireQuarantine?: boolean } = {}
): string[] {
  const reasons: string[] = [];
  const { requireQuarantine = false } = options;

  if (requireQuarantine && tank.kind !== "quarantine") {
    reasons.push("不是检疫缸（新鱼必须先进检疫缸观察）");
  }

  const occupied = tankOccupied(tank, state.batches);
  if (occupied + batch.quantity > tank.capacity) {
    reasons.push(
      `缸容不足：已占 ${occupied}/${tank.capacity} 尾，本批 ${batch.quantity} 尾放不下`
    );
  }

  if (tank.residue) {
    reasons.push("缸内有药水残留，需先清洗并确认无残留");
  }

  const { tempC, salinity } = tank.water;
  if (!inRange(tempC, batch.tempRange)) {
    reasons.push(
      `水温 ${tempC}℃ 不在该批适温 ${batch.tempRange.min}~${batch.tempRange.max}℃ 区间`
    );
  }
  if (!inRange(salinity, batch.salinityRange)) {
    reasons.push(
      `盐度 ${salinity}‰ 不在该批适盐 ${batch.salinityRange.min}~${batch.salinityRange.max}‰ 区间`
    );
  }

  // 原缸鱼耐受：并缸/调水后当前水质仍要满足所有在缸鱼批
  for (const resident of tankResidents(tank, state.batches)) {
    if (resident.id === batch.id) continue;
    if (!inRange(tempC, resident.tempRange)) {
      reasons.push(
        `原缸鱼 ${resident.species}（${resident.id}）不耐受：水温 ${tempC}℃ 超出其 ${resident.tempRange.min}~${resident.tempRange.max}℃`
      );
    }
    if (!inRange(salinity, resident.salinityRange)) {
      reasons.push(
        `原缸鱼 ${resident.species}（${resident.id}）不耐受：盐度 ${salinity}‰ 超出其 ${resident.salinityRange.min}~${resident.salinityRange.max}‰`
      );
    }
  }

  return reasons;
}

/** 观察期满且无异常，才允许转展示缸 */
export function displayReady(batch: Batch): string[] {
  const reasons: string[] = [];
  if (batch.status !== "quarantined" || !batch.tankId) {
    reasons.push("不在检疫缸观察中");
  }
  if (batch.abnormal) {
    reasons.push("观察期有异常未解除");
  }
  if (batch.daysObserved < batch.observeDays) {
    reasons.push(
      `观察未满：已观察 ${batch.daysObserved}/${batch.observeDays} 天`
    );
  }
  return reasons;
}

/** 汇总待入鱼批在所有检疫缸前的排位结果，供待入区逐项展示 */
export function evaluateWaiting(
  state: BoardState,
  batch: Batch
): WaitReasons {
  const quarantineTanks = state.tanks.filter((t) => t.kind === "quarantine");
  return {
    day: state.day,
    perTank: quarantineTanks.map((tank) => ({
      tankId: tank.id,
      reasons: checkTankForBatch(state, tank, batch, {
        requireQuarantine: true,
      }),
    })),
  };
}

/** 调水后实时核对：缸内哪些原住鱼对当前水质不耐受 */
export function residentWarnings(state: BoardState, tank: Tank): string[] {
  const warnings: string[] = [];
  const { tempC, salinity } = tank.water;
  for (const resident of tankResidents(tank, state.batches)) {
    if (!inRange(tempC, resident.tempRange)) {
      warnings.push(
        `${resident.species}（${resident.id}）：水温 ${tempC}℃ 超出其适温 ${resident.tempRange.min}~${resident.tempRange.max}℃`
      );
    }
    if (!inRange(salinity, resident.salinityRange)) {
      warnings.push(
        `${resident.species}（${resident.id}）：盐度 ${salinity}‰ 超出其适盐 ${resident.salinityRange.min}~${resident.salinityRange.max}‰`
      );
    }
  }
  return warnings;
}

// ---------- 状态变更（全部通过不可变更新产生新状态） ----------

const clone = (state: BoardState): BoardState => structuredClone(state);

function findTank(state: BoardState, tankId: string): Tank {
  const tank = state.tanks.find((t) => t.id === tankId);
  if (!tank) throw new RuleError(`缸号 ${tankId} 不存在`);
  return tank;
}

function findBatch(state: BoardState, batchId: string): Batch {
  const batch = state.batches.find((b) => b.id === batchId);
  if (!batch) throw new RuleError(`鱼批 ${batchId} 不存在`);
  return batch;
}

function pushEvent(batch: Batch, event: BatchEvent): void {
  batch.events.push(event);
}

/** 新增缸位：记录水量、温度、盐度、缸容 */
export function addTank(state: BoardState, input: AddTankInput): BoardState {
  const next = clone(state);
  if (input.id.trim() === "") throw new RuleError("缸号不能为空");
  if (next.tanks.some((t) => t.id === input.id.trim())) {
    throw new RuleError(`缸号 ${input.id} 已存在`);
  }
  if (input.capacity <= 0 || input.waterVolumeL <= 0) {
    throw new RuleError("水量和缸容必须大于 0");
  }
  next.tanks.push({
    id: input.id.trim(),
    name: input.name?.trim() || input.id.trim(),
    kind: input.kind,
    waterVolumeL: input.waterVolumeL,
    capacity: input.capacity,
    water: { tempC: input.tempC, salinity: input.salinity },
    residue: input.residue ?? false,
    batchIds: [],
  });
  return next;
}

/** 登记新鱼批，先进入待入区 */
export function admitBatch(
  state: BoardState,
  input: AdmitBatchInput
): BoardState {
  if (input.species.trim() === "") throw new RuleError("品种不能为空");
  if (input.quantity <= 0) throw new RuleError("数量必须大于 0");
  if (input.observeDays <= 0) throw new RuleError("观察天数必须大于 0");
  if (input.tempMin > input.tempMax || input.salinityMin > input.salinityMax) {
    throw new RuleError("适温/适盐区间下限不能大于上限");
  }

  const next = clone(state);
  const id = `F${String(next.nextBatchNo).padStart(3, "0")}`;
  const batch: Batch = {
    id,
    species: input.species.trim(),
    quantity: input.quantity,
    tempRange: { min: input.tempMin, max: input.tempMax },
    salinityRange: { min: input.salinityMin, max: input.salinityMax },
    observeDays: input.observeDays,
    status: "waiting",
    tankId: null,
    daysObserved: 0,
    abnormal: false,
    admittedDay: state.day,
    completedDay: null,
    events: [{ day: state.day, kind: "admit", note: "登记，进入待入区" }],
  };
  next.batches.push(batch);
  next.nextBatchNo += 1;

  // 登记时先做一次排位检查，缺项留在待入区并写明原因
  batch.waitReasons = evaluateWaiting(next, batch);
  return next;
}

export interface PlaceResult {
  state: BoardState;
  ok: boolean;
  placedTankId?: string;
  message: string;
  reasons?: { tankId: string; reasons: string[] }[];
}

/** 指定缸位尝试入缸；不合格则留在待入区，写明原因 */
export function attemptPlace(
  state: BoardState,
  batchId: string,
  tankId: string
): PlaceResult {
  const next = clone(state);
  const batch = findBatch(next, batchId);
  if (batch.status !== "waiting") {
    throw new RuleError(`${batchId} 不在待入区，当前状态：${batch.status}`);
  }
  const tank = findTank(next, tankId);

  const reasons = checkTankForBatch(next, tank, batch, {
    requireQuarantine: true,
  });
  if (reasons.length > 0) {
    batch.waitReasons = { day: next.day, perTank: [{ tankId, reasons }] };
    return {
      state: next,
      ok: false,
      message: `${batch.id} ${batch.species} 留在待入区：${tank.id} 不满足`,
      reasons: [{ tankId, reasons }],
    };
  }

  tank.batchIds.push(batch.id);
  batch.status = "quarantined";
  batch.tankId = tank.id;
  batch.waitReasons = undefined;
  pushEvent(batch, {
    day: next.day,
    kind: "place",
    fromTankId: null,
    toTankId: tank.id,
    water: { ...tank.water },
    note: "排位通过：空间、水质、药水残留、原缸鱼耐受均已核对",
  });
  return {
    state: next,
    ok: true,
    placedTankId: tank.id,
    message: `${batch.id} ${batch.species} 已入检疫缸 ${tank.id}（占用 +${batch.quantity} 尾）`,
  };
}

/** 自动排位：按缸号顺序找第一个全部项目合格的检疫缸；全部不合格则留待入区 */
export function autoPlace(
  state: BoardState,
  batchId: string
): PlaceResult {
  const next = clone(state);
  const batch = findBatch(next, batchId);
  if (batch.status !== "waiting") {
    throw new RuleError(`${batchId} 不在待入区`);
  }

  const evaluation = evaluateWaiting(next, batch);
  const eligible = evaluation.perTank.find((r) => r.reasons.length === 0);
  if (!eligible) {
    batch.waitReasons = evaluation;
    return {
      state: next,
      ok: false,
      message: `${batch.id} ${batch.species} 无合格检疫缸，留在待入区`,
      reasons: evaluation.perTank,
    };
  }
  return attemptPlace(next, batchId, eligible.tankId);
}

/**
 * 推进一天：观察中的鱼批累计观察天数；
 * 异常未解除期间不计观察天数。
 */
export function advanceDay(state: BoardState): BoardState {
  const next = clone(state);
  next.day += 1;
  for (const batch of next.batches) {
    if (batch.status === "quarantined" && !batch.abnormal) {
      batch.daysObserved += 1;
    }
  }
  return next;
}

export function markAbnormal(
  state: BoardState,
  batchId: string,
  note?: string
): BoardState {
  const next = clone(state);
  const batch = findBatch(next, batchId);
  if (batch.status !== "quarantined") {
    throw new RuleError("只有检疫观察中的鱼批可以标记异常");
  }
  if (!batch.abnormal) {
    batch.abnormal = true;
    pushEvent(batch, { day: next.day, kind: "abnormal", note });
  }
  return next;
}

/** 异常解除：观察天数重新计 */
export function clearAbnormal(
  state: BoardState,
  batchId: string,
  note?: string
): BoardState {
  const next = clone(state);
  const batch = findBatch(next, batchId);
  if (!batch.abnormal) throw new RuleError("该鱼批当前没有异常");
  batch.abnormal = false;
  batch.daysObserved = 0;
  pushEvent(batch, { day: next.day, kind: "recover", note });
  return next;
}

/**
 * 中途换缸：整批处理，不拆分；只能检疫缸之间换。
 * 目标缸仍核对空间、水质、药水残留和原缸鱼耐受；原缸位占用立即释放。
 */
export function moveBatch(
  state: BoardState,
  batchId: string,
  targetTankId: string
): BoardState {
  const next = clone(state);
  const batch = findBatch(next, batchId);
  if (batch.status !== "quarantined" || !batch.tankId) {
    throw new RuleError("只有检疫观察中的鱼批可以中途换缸");
  }
  const from = findTank(next, batch.tankId);
  const to = findTank(next, targetTankId);
  if (from.id === to.id) throw new RuleError("目标缸与当前缸相同");
  if (to.kind !== "quarantine") {
    throw new RuleError("中途换缸只能换入检疫缸；转展示缸请走转缸流程");
  }

  // 先从原缸临时摘除再检查，避免整批自己和自己比空间
  from.batchIds = from.batchIds.filter((id) => id !== batch.id);
  const reasons = checkTankForBatch(next, to, batch, {
    requireQuarantine: true,
  });
  if (reasons.length > 0) {
    // 校验失败，还原占用，状态不变
    from.batchIds.push(batch.id);
    throw new RuleError(`${to.id} 不满足：${reasons.join("；")}`);
  }

  to.batchIds.push(batch.id);
  batch.tankId = to.id;
  pushEvent(batch, {
    day: next.day,
    kind: "move",
    fromTankId: from.id,
    toTankId: to.id,
    water: { ...to.water },
    note: `整批换缸（观察进度 ${batch.daysObserved}/${batch.observeDays} 天延续，占用自 ${from.id} 释放）`,
  });
  return next;
}

/**
 * 转展示缸：观察期满且无异常才可转；
 * 转缸仍逐项核对水质与空间，通过后释放原检疫缸位，已完成记录留缸号和水质。
 */
export function transferToDisplay(
  state: BoardState,
  batchId: string,
  displayTankId: string
): BoardState {
  const next = clone(state);
  const batch = findBatch(next, batchId);

  const readyReasons = displayReady(batch);
  if (readyReasons.length > 0) {
    throw new RuleError(readyReasons.join("；"));
  }

  const display = findTank(next, displayTankId);
  if (display.kind !== "display") {
    throw new RuleError(`${displayTankId} 不是展示缸`);
  }
  const from = findTank(next, batch.tankId as string);

  // 同样先释放原缸位再检查目标缸
  from.batchIds = from.batchIds.filter((id) => id !== batch.id);
  const reasons = checkTankForBatch(next, display, batch);
  if (reasons.length > 0) {
    from.batchIds.push(batch.id);
    throw new RuleError(`${display.id} 不满足：${reasons.join("；")}`);
  }

  display.batchIds.push(batch.id);
  batch.status = "completed";
  batch.tankId = display.id;
  batch.completedDay = next.day;
  pushEvent(batch, {
    day: next.day,
    kind: "complete",
    fromTankId: from.id,
    toTankId: display.id,
    water: { ...display.water },
    note: `观察期满 ${batch.daysObserved}/${batch.observeDays} 天且无异常，检疫缸位 ${from.id} 已释放`,
  });

  const record: CompletionRecord = {
    batchId: batch.id,
    species: batch.species,
    quantity: batch.quantity,
    quarantineTankId: from.id,
    displayTankId: display.id,
    observedDays: batch.daysObserved,
    day: next.day,
    water: { ...display.water },
  };
  next.completions.unshift(record);
  return next;
}

/** 调整缸位当前水质（温度/盐度），调整后自动重算原缸鱼耐受预警（在 UI 中展示） */
export function updateTankWater(
  state: BoardState,
  tankId: string,
  water: Water
): BoardState {
  const next = clone(state);
  const tank = findTank(next, tankId);
  tank.water = { tempC: water.tempC, salinity: water.salinity };
  return next;
}

/** 清洗缸位，确认药水残留清除 */
export function clearResidue(state: BoardState, tankId: string): BoardState {
  const next = clone(state);
  const tank = findTank(next, tankId);
  tank.residue = false;
  return next;
}

/** 重新评估所有待入鱼批（调水/清残留后刷新待入区原因） */
export function refreshWaiting(state: BoardState): BoardState {
  const next = clone(state);
  for (const batch of next.batches) {
    if (batch.status === "waiting") {
      batch.waitReasons = evaluateWaiting(next, batch);
    }
  }
  return next;
}
