// 入缸排队台领域模型

/** 缸位类型：检疫缸 / 展示缸 */
export type TankKind = "quarantine" | "display";

/** 鱼批状态：待入区 / 检疫观察中 / 已完成（转展示缸） */
export type BatchStatus = "waiting" | "quarantined" | "completed";

/** 水质快照：水温 ℃、盐度 ‰（千分比） */
export interface Water {
  tempC: number;
  salinity: number;
}

/** 适温 / 适盐区间，闭区间 */
export interface Range {
  min: number;
  max: number;
}

export interface Tank {
  /** 缸号，如 Q1、D1 */
  id: string;
  name: string;
  kind: TankKind;
  /** 水量（L） */
  waterVolumeL: number;
  /** 缸容（鱼只上限，尾） */
  capacity: number;
  /** 当前水质：水温、盐度 */
  water: Water;
  /** 药水残留：有残留时禁止新鱼并缸 */
  residue: boolean;
  /** 在缸鱼批 id（已完成的鱼批仍占用展示缸位） */
  batchIds: string[];
}

export type BatchEventKind =
  | "admit" // 登记待入
  | "place" // 入检疫缸
  | "move" // 中途换缸（检疫缸之间，整批）
  | "abnormal" // 观察期标记异常
  | "recover" // 异常解除
  | "complete"; // 转展示缸

export interface BatchEvent {
  day: number;
  kind: BatchEventKind;
  fromTankId?: string | null;
  toTankId?: string | null;
  /** 事件发生时的水质快照 */
  water?: Water;
  note?: string;
}

/** 最近一次排位失败的逐项原因（按缸记录） */
export interface WaitReasons {
  day: number;
  perTank: { tankId: string; reasons: string[] }[];
}

export interface Batch {
  id: string;
  /** 品种 */
  species: string;
  /** 数量（尾），整批处理不可拆分 */
  quantity: number;
  tempRange: Range;
  salinityRange: Range;
  /** 需观察天数 */
  observeDays: number;

  status: BatchStatus;
  tankId: string | null;
  /** 已观察天数（异常期间不计，解除后重新计） */
  daysObserved: number;
  abnormal: boolean;

  admittedDay: number;
  completedDay: number | null;
  events: BatchEvent[];
  /** 待入区：最近一次排位失败原因 */
  waitReasons?: WaitReasons;
}

/** 已完成记录：留缸号（检疫缸 + 展示缸）和水质 */
export interface CompletionRecord {
  batchId: string;
  species: string;
  quantity: number;
  quarantineTankId: string | null;
  displayTankId: string;
  observedDays: number;
  day: number;
  /** 转展示缸时的展示缸水质 */
  water: Water;
}

export interface BoardState {
  /** 模拟营业日，用于观察期计时 */
  day: number;
  nextBatchNo: number;
  tanks: Tank[];
  batches: Batch[];
  completions: CompletionRecord[];
}

export interface AddTankInput {
  id: string;
  name?: string;
  kind: TankKind;
  waterVolumeL: number;
  capacity: number;
  tempC: number;
  salinity: number;
  residue?: boolean;
}

export interface AdmitBatchInput {
  species: string;
  quantity: number;
  tempMin: number;
  tempMax: number;
  salinityMin: number;
  salinityMax: number;
  observeDays: number;
}
