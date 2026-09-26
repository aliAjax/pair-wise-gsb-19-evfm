// 规则引擎端到端验证：npx tsx src/queue/engine.test.ts
// 覆盖：排位缺项留待入、入缸占用、观察期/异常、整批换缸、转展示缸与缸位释放
import { createSeedState } from "./seed";
import {
  addTank,
  admitBatch,
  advanceDay,
  autoPlace,
  attemptPlace,
  checkTankForBatch,
  clearAbnormal,
  clearResidue,
  displayReady,
  markAbnormal,
  moveBatch,
  refreshWaiting,
  RuleError,
  transferToDisplay,
  updateTankWater,
  type PlaceResult,
} from "./engine";
import type { BoardState } from "./types";

let passed = 0;
function ok(cond: boolean, label: string) {
  if (!cond) throw new Error(`断言失败: ${label}`);
  passed += 1;
  console.log(`  ✓ ${label}`);
}
function expectError(fn: () => unknown, fragment: string, label: string) {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
    const msg = e instanceof RuleError ? e.message : String(e);
    if (!msg.includes(fragment)) {
      throw new Error(`${label}: 期望包含「${fragment}」，实际「${msg}」`);
    }
  }
  if (!threw) throw new Error(`${label}: 预期抛错但没有`);
  passed += 1;
  console.log(`  ✓ ${label}（拦截：${fragment}）`);
}

const occ = (s: BoardState, id: string) => {
  const t = s.tanks.find((x) => x.id === id)!;
  return t.batchIds.reduce(
    (sum, bid) => sum + s.batches.find((b) => b.id === bid)!.quantity,
    0
  );
};
const get = (s: BoardState, id: string) => s.batches.find((b) => b.id === id)!;

console.log("1) 初始排位：可入 / 空间不足 / 水温不适 / 药水残留");
let s = createSeedState();
const f2 = get(s, "F002");
const f3 = get(s, "F003");
const f4 = get(s, "F004");
ok(f2.status === "waiting", "F002 在待入区");
ok(f2.waitReasons!.perTank.some((r) => r.reasons.length === 0), "F002 至少一个检疫缸全部通过");
ok(
  f3.waitReasons!.perTank.every((r) => r.reasons.length > 0),
  "F003 在所有检疫缸都不满足，留待入区"
);
ok(
  f3.waitReasons!.perTank.find((r) => r.tankId === "Q2")!.reasons.some((r) => r.includes("药水残留")),
  "F003→Q2 写明药水残留"
);
ok(
  f3.waitReasons!.perTank.find((r) => r.tankId === "Q1")!.reasons.some((r) => r.includes("缸容不足")),
  "F003→Q1 写明缸容不足"
);
ok(
  f4.waitReasons!.perTank.every((r) => r.reasons.some((x) => x.includes("水温"))),
  "F004 在所有检疫缸都写明水温不在适温区间"
);

console.log("2) 自动排位与指定入缸，占用增加");
const before = occ(s, "Q1");
const placed = autoPlace(s, "F002");
s = placed.state;
ok(placed.ok, "F002 自动排位成功");
ok(get(s, "F002").status === "quarantined", "F002 进入检疫观察");
ok(get(s, "F002").tankId === "Q1", "F002 按顺序进入 Q1");
ok(occ(s, "Q1") === before + 2, "Q1 占用增加 2（原有 F001 6 尾 → 8 尾）");

console.log("3) 不合格指定入缸：留在待入区并写明原因，占用不变");
const q2Occ = occ(s, "Q2");
const fail: PlaceResult = attemptPlace(s, "F003", "Q2");
s = fail.state;
ok(!fail.ok, "F003→Q2 被拒绝");
ok(get(s, "F003").status === "waiting", "F003 仍在待入区");
ok(occ(s, "Q2") === q2Occ, "Q2 占用不变");
ok(fail.reasons![0].reasons.some((r) => r.includes("药水残留")), "拒绝原因含药水残留");

console.log("4) 清洗去残留 + 调水后，待入区实时重算并可入");
s = clearResidue(s, "Q2"); // F003 14 尾，Q2 容量 25，清空后可放
s = refreshWaiting(s);
ok(
  get(s, "F003").waitReasons!.perTank.find((r) => r.tankId === "Q2")!.reasons.length === 0,
  "Q2 清残留后 F003 在 Q2 全部通过"
);
// F004 需要高水温：把 Q3 调到 27℃ 后应通过（Q3 为空，无原缸鱼问题）
s = updateTankWater(s, "Q3", { tempC: 27, salinity: 35 });
s = refreshWaiting(s);
ok(
  get(s, "F004").waitReasons!.perTank.find((r) => r.tankId === "Q3")!.reasons.length === 0,
  "Q3 调至 27℃ 后 F004 通过"
);
s = autoPlace(s, "F003").state;
ok(get(s, "F003").tankId === "Q2", "F003 自动排位进入 Q2");
s = autoPlace(s, "F004").state;
ok(get(s, "F004").tankId === "Q3", "F004 自动排位进入 Q3");

console.log("5) 原缸鱼耐受：往有鱼的缸调极端水温会触发耐受拦截");
s = updateTankWater(s, "Q1", { tempC: 29, salinity: 35 });
const q1 = s.tanks.find((t) => t.id === "Q1")!;
ok(
  checkTankForBatch(s, q1, get(s, "F003")).some((r) => r.includes("原缸鱼") && r.includes("不耐受")),
  "高温水对 Q1 原缸鱼判定不耐受"
);
// 温度复位
s = updateTankWater(s, "Q1", { tempC: 25.5, salinity: 35 });

console.log("6) 观察期：天数累计、异常暂停、解除重计、未满禁转");
const f1Start = get(s, "F001").daysObserved;
s = advanceDay(s);
ok(get(s, "F001").daysObserved === f1Start + 1, "快进一天，F001 观察 +1（4/7）");
s = markAbnormal(s, "F001", "白点");
const atAbnormal = get(s, "F001").daysObserved;
s = advanceDay(s);
ok(get(s, "F001").daysObserved === atAbnormal, "异常期间天数不累计");
ok(displayReady(get(s, "F001")).some((r) => r.includes("异常")), "有异常不可转展示缸");
s = clearAbnormal(s, "F001");
ok(get(s, "F001").daysObserved === 0, "异常解除后观察天数归零重计");
expectError(() => transferToDisplay(s, "F001", "D1"), "观察未满", "观察未满禁止转缸");

console.log("7) 观察满期且无异常 → 转展示缸：核对水质、释放检疫缸位、留档");
for (let i = 0; i < 7; i++) s = advanceDay(s);
ok(get(s, "F001").daysObserved === 7, "F001 观察满 7/7");
ok(displayReady(get(s, "F001")).length === 0, "F001 满足转缸前置条件");
const q1Before = occ(s, "Q1");
const d1Before = occ(s, "D1");
s = transferToDisplay(s, "F001", "D1");
ok(get(s, "F001").status === "completed", "F001 已完成");
ok(get(s, "F001").tankId === "D1", "F001 在展示缸 D1");
ok(occ(s, "Q1") === q1Before - 6, "检疫缸 Q1 释放 6 尾占用");
ok(occ(s, "D1") === d1Before + 6, "展示缸 D1 增加 6 尾占用");
const rec = s.completions.find((c) => c.batchId === "F001")!;
ok(Boolean(rec), "完成记录已留存");
ok(rec.quarantineTankId === "Q1" && rec.displayTankId === "D1", "记录留检疫缸号与展示缸号");
ok(rec.water.tempC === 25.5 && rec.water.salinity === 35, "记录留转缸时水质");

console.log("8) 转缸仍核对：展示缸水质不合规拒绝转缸且检疫缸位不释放");
const f2batch = get(s, "F002");
for (let i = 0; i < 14; i++) s = advanceDay(s);
ok(f2batch.observeDays === 14, "F002 观察要求 14 天");
s = updateTankWater(s, "D1", { tempC: 30, salinity: 35 }); // 超出蓝吊适温 24~26
const q2BeforeMove = occ(s, "Q2");
expectError(() => transferToDisplay(s, "F002", "D1"), "水温", "展示缸水温越界禁止转缸");
ok(get(s, "F002").status === "quarantined", "F002 仍在检疫状态");
ok(occ(s, "Q2") === q2BeforeMove, "转缸失败，检疫缸占用未释放");
s = updateTankWater(s, "D1", { tempC: 25.5, salinity: 35 });

console.log("9) 中途换缸：整批处理、重新核对、原缸位释放；不能换展示缸");
const f4b = get(s, "F004");
ok(f4b.status === "quarantined" && f4b.tankId === "Q3", "F004 当前在 Q3");
expectError(() => moveBatch(s, "F004", "D1"), "只能换入检疫缸", "中途换缸不能直接去展示缸");
// 新建一个合格检疫缸 Q4（27℃ 高水温匹配雷达鱼）
s = addTank(s, {
  id: "Q4",
  name: "检疫缸 4 号",
  kind: "quarantine",
  waterVolumeL: 90,
  capacity: 20,
  tempC: 27,
  salinity: 35,
});
const q3Occ = occ(s, "Q3");
s = moveBatch(s, "F004", "Q4");
ok(get(s, "F004").tankId === "Q4", "F004 整批换入 Q4");
ok(occ(s, "Q3") === q3Occ - 4, "Q3 原缸位释放 4 尾");
ok(occ(s, "Q4") === 4, "Q4 增加 4 尾占用");
ok(
  get(s, "F004").events.some((e) => e.kind === "move" && e.fromTankId === "Q3" && e.toTankId === "Q4"),
  "流转记录整批换缸留痕（含缸号、水质）"
);
ok(get(s, "F004").daysObserved > 0, "换缸后观察天数延续，不重新计");
// 换到不合格缸被拒且状态不变
s = updateTankWater(s, "Q1", { tempC: 25.5, salinity: 35 });
expectError(() => moveBatch(s, "F004", "Q1"), "水温", "换缸目标水温不合规被拒");
ok(get(s, "F004").tankId === "Q4", "换缸失败，F004 仍在 Q4");

console.log("10) 登记校验与缸容硬约束");
expectError(
  () => admitBatch(s, { species: " ", quantity: 1, tempMin: 1, tempMax: 2, salinityMin: 1, salinityMax: 2, observeDays: 3 }),
  "品种不能为空",
  "品种为空拒绝登记"
);
expectError(
  () => admitBatch(s, { species: "x", quantity: 1, tempMin: 28, tempMax: 24, salinityMin: 1, salinityMax: 2, observeDays: 3 }),
  "下限不能大于上限",
  "适温区间颠倒拒绝登记"
);
// 缸容超限：新建容量 1 的缸，登记一批 4 尾待入鱼必拒
s = addTank(s, {
  id: "Q5",
  name: "小检疫缸",
  kind: "quarantine",
  waterVolumeL: 20,
  capacity: 1,
  tempC: 27,
  salinity: 35,
});
s = admitBatch(s, {
  species: "草莓鱼",
  quantity: 4,
  tempMin: 25,
  tempMax: 28,
  salinityMin: 32,
  salinityMax: 36,
  observeDays: 5,
});
const tinyFail = attemptPlace(s, "F006", "Q5");
ok(!tinyFail.ok && tinyFail.reasons![0].reasons.some((r) => r.includes("缸容不足")), "缸容不足整批放不下，拒绝入缸");

console.log(`\n全部通过：${passed} 项断言`);
