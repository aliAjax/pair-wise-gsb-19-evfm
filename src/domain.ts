export type TankKind = "quarantine" | "display";

export interface Tank {
  id: string; // 缸号
  kind: TankKind; // 检疫缸 / 展示缸
  waterVolume: number; // 水量（L）
  temperature: number; // 温度（℃）
  salinity: number; // 盐度（‰）
  capacity: number; // 缸容（尾数上限）
  medicated: boolean; // 是否有药水残留
}

export type BatchStatus = "waiting" | "quarantine" | "done";

export interface WaterSnapshot {
  temperature: number;
  salinity: number;
  waterVolume: number;
}

export interface StayRecord extends WaterSnapshot {
  tankId: string;
  tankKind: TankKind;
  enteredAt: string; // 入缸日 YYYY-MM-DD
  leftAt: string | null; // 出缸日，在缸为 null
}

export interface Batch {
  id: string; // 批次号
  species: string; // 品种
  quantity: number; // 数量（尾）
  tempMin: number; // 适温区间
  tempMax: number;
  salMin: number; // 适盐区间
  salMax: number;
  observeDays: number; // 观察天数
  status: BatchStatus;
  currentTankId: string | null; // 当前占用缸位（待入区为 null）
  enteredAt: string | null; // 当前缸入缸日
  abnormal: boolean; // 是否有异常未解除
  abnormalNote: string;
  stayReason: string; // 滞留待入区 / 最近一次核对未过的原因
  history: StayRecord[]; // 入缸履历（含各缸水质快照）
  completedAt: string | null; // 完成（转入展示缸）日期
  completedTankId: string | null; // 完成记录留档：缸号
  completedWater: WaterSnapshot | null; // 完成记录留档：入缸水质
}

export interface QueueState {
  today: string; // 营业日期 YYYY-MM-DD
  tanks: Tank[];
  batches: Batch[];
}

export const KIND_LABEL: Record<TankKind, string> = {
  quarantine: "检疫缸",
  display: "展示缸",
};

/** 缸位已占用尾数：由在缸鱼批推导，入缸即增加、出缸即释放 */
export function occupancyOf(tankId: string, batches: Batch[]): number {
  return batches
    .filter((b) => b.currentTankId === tankId)
    .reduce((sum, b) => sum + b.quantity, 0);
}

export function residentsOf(tankId: string, batches: Batch[]): Batch[] {
  return batches.filter((b) => b.currentTankId === tankId);
}

export function batchFitsWater(batch: Batch, temperature: number, salinity: number): boolean {
  return (
    temperature >= batch.tempMin &&
    temperature <= batch.tempMax &&
    salinity >= batch.salMin &&
    salinity <= batch.salMax
  );
}

/**
 * 排位 / 转展示缸 / 中途换缸共用核对：
 * 空间、水温、盐度、药水残留、原缸鱼耐受。
 * 返回缺项列表，空数组表示可以入缸。
 */
export function checkTankForBatch(tank: Tank, batch: Batch, batches: Batch[]): string[] {
  const problems: string[] = [];
  const free = tank.capacity - occupancyOf(tank.id, batches);
  if (batch.quantity > free) {
    problems.push(`空间不足（余 ${Math.max(free, 0)} 尾，需 ${batch.quantity} 尾）`);
  }
  if (tank.temperature < batch.tempMin || tank.temperature > batch.tempMax) {
    problems.push(`水温 ${tank.temperature}℃ 不在适温 ${batch.tempMin}–${batch.tempMax}℃`);
  }
  if (tank.salinity < batch.salMin || tank.salinity > batch.salMax) {
    problems.push(`盐度 ${tank.salinity}‰ 不在适盐 ${batch.salMin}–${batch.salMax}‰`);
  }
  if (tank.medicated) {
    problems.push("缸内有药水残留，需先洗缸换水");
  }
  for (const r of residentsOf(tank.id, batches)) {
    if (r.id !== batch.id && !batchFitsWater(r, tank.temperature, tank.salinity)) {
      problems.push(`原缸鱼「${r.species}」不耐受当前水质`);
    }
  }
  return problems;
}

export function daysBetween(from: string, to: string): number {
  const ms = Date.parse(to + "T00:00:00") - Date.parse(from + "T00:00:00");
  return Math.round(ms / 86400000);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function nextBatchId(batches: Batch[]): string {
  const nums = batches
    .map((b) => /^B-(\d+)$/.exec(b.id))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `B-${String(next).padStart(2, "0")}`;
}

export function seedState(): QueueState {
  const today = "2026-09-26";
  const tanks: Tank[] = [
    { id: "Q-01", kind: "quarantine", waterVolume: 60, temperature: 25, salinity: 0, capacity: 20, medicated: false },
    { id: "Q-02", kind: "quarantine", waterVolume: 40, temperature: 26, salinity: 5, capacity: 12, medicated: true },
    { id: "Q-03", kind: "quarantine", waterVolume: 80, temperature: 24, salinity: 0, capacity: 30, medicated: false },
    { id: "S-01", kind: "display", waterVolume: 200, temperature: 25, salinity: 0, capacity: 80, medicated: false },
    { id: "S-02", kind: "display", waterVolume: 120, temperature: 26, salinity: 33, capacity: 40, medicated: false },
  ];
  const batches: Batch[] = [
    {
      id: "B-00", species: "斑马鱼", quantity: 8,
      tempMin: 22, tempMax: 26, salMin: 0, salMax: 2, observeDays: 7,
      status: "done", currentTankId: "S-01", enteredAt: addDays(today, -1),
      abnormal: false, abnormalNote: "", stayReason: "",
      history: [
        { tankId: "Q-01", tankKind: "quarantine", enteredAt: addDays(today, -8), leftAt: addDays(today, -1), temperature: 25, salinity: 0, waterVolume: 60 },
        { tankId: "S-01", tankKind: "display", enteredAt: addDays(today, -1), leftAt: null, temperature: 25, salinity: 0, waterVolume: 200 },
      ],
      completedAt: addDays(today, -1), completedTankId: "S-01",
      completedWater: { temperature: 25, salinity: 0, waterVolume: 200 },
    },
    {
      id: "B-01", species: "孔雀鱼", quantity: 10,
      tempMin: 22, tempMax: 26, salMin: 0, salMax: 2, observeDays: 7,
      status: "waiting", currentTankId: null, enteredAt: null,
      abnormal: false, abnormalNote: "", stayReason: "新登记，待排位",
      history: [], completedAt: null, completedTankId: null, completedWater: null,
    },
    {
      id: "B-02", species: "红绿灯", quantity: 15,
      tempMin: 23, tempMax: 27, salMin: 0, salMax: 1, observeDays: 5,
      status: "waiting", currentTankId: null, enteredAt: null,
      abnormal: false, abnormalNote: "", stayReason: "新登记，待排位",
      history: [], completedAt: null, completedTankId: null, completedWater: null,
    },
    {
      id: "B-03", species: "金菠萝", quantity: 6,
      tempMin: 24, tempMax: 26, salMin: 0, salMax: 3, observeDays: 7,
      status: "quarantine", currentTankId: "Q-03", enteredAt: addDays(today, -3),
      abnormal: false, abnormalNote: "", stayReason: "",
      history: [
        { tankId: "Q-03", tankKind: "quarantine", enteredAt: addDays(today, -3), leftAt: null, temperature: 24, salinity: 0, waterVolume: 80 },
      ],
      completedAt: null, completedTankId: null, completedWater: null,
    },
    {
      id: "B-04", species: "小丑鱼", quantity: 4,
      tempMin: 25, tempMax: 27, salMin: 30, salMax: 35, observeDays: 10,
      status: "waiting", currentTankId: null, enteredAt: null,
      abnormal: false, abnormalNote: "", stayReason: "新登记，待排位",
      history: [], completedAt: null, completedTankId: null, completedWater: null,
    },
  ];
  return { today, tanks, batches };
}
