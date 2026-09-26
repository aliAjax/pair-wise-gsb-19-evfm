import type { Batch, BoardState, Tank } from "./types";
import { evaluateWaiting } from "./engine";

/** 初始缸位：水量、温度、盐度、缸容齐全 */
function tank(
  id: string,
  name: string,
  kind: Tank["kind"],
  waterVolumeL: number,
  capacity: number,
  tempC: number,
  salinity: number,
  residue = false
): Tank {
  return {
    id,
    name,
    kind,
    waterVolumeL,
    capacity,
    water: { tempC, salinity },
    residue,
    batchIds: [],
  };
}

/** 初始示例：覆盖观察中、待入区不同缺项、已完成记录 */
export function createSeedState(): BoardState {
  const state: BoardState = {
    day: 3,
    nextBatchNo: 6,
    tanks: [
      tank("Q1", "检疫缸 1 号", "quarantine", 120, 18, 25.5, 35, false),
      tank("Q2", "检疫缸 2 号（刚下药）", "quarantine", 100, 25, 25, 35, true),
      tank("Q3", "检疫缸 3 号", "quarantine", 80, 12, 24, 35, false),
      tank("D1", "展示缸 主海缸", "display", 600, 120, 25.5, 35, false),
    ],
    batches: [],
    completions: [],
  };

  const f001: Batch = {
    id: "F001",
    species: "公子小丑鱼",
    quantity: 6,
    tempRange: { min: 24, max: 27 },
    salinityRange: { min: 32, max: 36 },
    observeDays: 7,
    status: "quarantined",
    tankId: "Q1",
    daysObserved: 3,
    abnormal: false,
    admittedDay: 0,
    completedDay: null,
    events: [
      { day: 0, kind: "admit", note: "登记，进入待入区" },
      {
        day: 0,
        kind: "place",
        fromTankId: null,
        toTankId: "Q1",
        water: { tempC: 25.5, salinity: 35 },
        note: "排位通过入检疫缸",
      },
    ],
  };

  // F002：各检疫缸均合格，可直接排位
  const f002: Batch = {
    id: "F002",
    species: "蓝吊",
    quantity: 2,
    tempRange: { min: 24, max: 26 },
    salinityRange: { min: 33, max: 36 },
    observeDays: 14,
    status: "waiting",
    tankId: null,
    daysObserved: 0,
    abnormal: false,
    admittedDay: 3,
    completedDay: null,
    events: [{ day: 3, kind: "admit", note: "登记，进入待入区" }],
  };

  // F003：数量大——Q1 缸容不足、Q2 有药水残留、Q3 缸容不足，留在待入区
  const f003: Batch = {
    id: "F003",
    species: "黄金鳚",
    quantity: 14,
    tempRange: { min: 24, max: 27 },
    salinityRange: { min: 32, max: 35 },
    observeDays: 7,
    status: "waiting",
    tankId: null,
    daysObserved: 0,
    abnormal: false,
    admittedDay: 3,
    completedDay: null,
    events: [{ day: 3, kind: "admit", note: "登记，进入待入区" }],
  };

  // F004：要求偏高水温，当前所有检疫缸水温都不达标
  const f004: Batch = {
    id: "F004",
    species: "雷达鱼",
    quantity: 4,
    tempRange: { min: 26.5, max: 28 },
    salinityRange: { min: 33, max: 36 },
    observeDays: 10,
    status: "waiting",
    tankId: null,
    daysObserved: 0,
    abnormal: false,
    admittedDay: 3,
    completedDay: null,
    events: [{ day: 3, kind: "admit", note: "登记，进入待入区" }],
  };

  // F005：已完成示例，占用展示缸位，完成记录留缸号和水质
  const f005: Batch = {
    id: "F005",
    species: "青魔",
    quantity: 8,
    tempRange: { min: 24, max: 27 },
    salinityRange: { min: 32, max: 36 },
    observeDays: 7,
    status: "completed",
    tankId: "D1",
    daysObserved: 7,
    abnormal: false,
    admittedDay: 0,
    completedDay: 2,
    events: [
      { day: 0, kind: "admit", note: "登记，进入待入区" },
      { day: 0, kind: "place", fromTankId: null, toTankId: "Q3", water: { tempC: 24, salinity: 35 }, note: "排位通过入检疫缸" },
      {
        day: 2,
        kind: "complete",
        fromTankId: "Q3",
        toTankId: "D1",
        water: { tempC: 25.5, salinity: 35 },
        note: "观察期满 7/7 天且无异常，检疫缸位 Q3 已释放",
      },
    ],
  };

  state.batches = [f001, f002, f003, f004, f005];
  state.tanks[0].batchIds = ["F001"];
  state.tanks[3].batchIds = ["F005"];
  state.completions = [
    {
      batchId: "F005",
      species: "青魔",
      quantity: 8,
      quarantineTankId: "Q3",
      displayTankId: "D1",
      observedDays: 7,
      day: 2,
      water: { tempC: 25.5, salinity: 35 },
    },
  ];

  for (const batch of state.batches) {
    if (batch.status === "waiting") {
      batch.waitReasons = evaluateWaiting(state, batch);
    }
  }
  return state;
}
