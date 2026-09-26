import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardState } from "./types";
import {
  RuleError,
  type PlaceResult,
  refreshWaiting,
  updateTankWater,
  clearResidue,
} from "./engine";
import { createSeedState } from "./seed";

const STORAGE_KEY = "acclimation-board-v1";

export interface Flash {
  type: "ok" | "err";
  text: string;
}

function loadState(): BoardState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as BoardState;
      if (parsed && Array.isArray(parsed.tanks) && Array.isArray(parsed.batches)) {
        return parsed;
      }
    }
  } catch {
    // 存档损坏时回落到示例数据
  }
  return createSeedState();
}

export function useBoard() {
  const [state, setState] = useState<BoardState>(loadState);
  const [flash, setFlash] = useState<Flash | null>(null);
  const timer = useRef<number | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // 存储不可用时不影响使用
    }
  }, [state]);

  const notify = useCallback((next: Flash) => {
    setFlash(next);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setFlash(null), 4000);
  }, []);

  /** 执行一条纯函数规则，RuleError 会以错误提示呈现，不改变状态 */
  const apply = useCallback(
    (fn: (prev: BoardState) => BoardState, okMsg: string) => {
      try {
        const next = fn(stateRef.current);
        setState(next);
        notify({ type: "ok", text: okMsg });
      } catch (error) {
        const text = error instanceof RuleError ? error.message : String(error);
        notify({ type: "err", text });
      }
    },
    [notify]
  );

  /** 入缸类操作：不合格时鱼批留在待入区（状态仍更新为带原因），按结果提示 */
  const applyPlace = useCallback(
    (fn: (prev: BoardState) => PlaceResult) => {
      try {
        const result = fn(stateRef.current);
        setState(result.state);
        notify({ type: result.ok ? "ok" : "err", text: result.message });
      } catch (error) {
        const text = error instanceof RuleError ? error.message : String(error);
        notify({ type: "err", text });
      }
    },
    [notify]
  );

  /** 调水后同步刷新待入区排位原因和原缸鱼耐受 */
  const applyWater = useCallback(
    (tankId: string, tempC: number, salinity: number) => {
      apply(
        (prev) =>
          refreshWaiting(updateTankWater(prev, tankId, { tempC, salinity })),
        `缸位 ${tankId} 水质已更新，已重新核对原缸鱼耐受和待入排位`
      );
    },
    [apply]
  );

  const applyClearResidue = useCallback(
    (tankId: string) => {
      apply(
        (prev) => refreshWaiting(clearResidue(prev, tankId)),
        `缸位 ${tankId} 已清洗，药水残留清除，已重算待入排位`
      );
    },
    [apply]
  );

  const reset = useCallback(() => {
    const seed = createSeedState();
    setState(seed);
    stateRef.current = seed;
    notify({ type: "ok", text: "已重置为示例数据" });
  }, [notify]);

  return {
    state,
    flash,
    apply,
    applyPlace,
    applyWater,
    applyClearResidue,
    reset,
  };
}
