import { useEffect, useState } from 'react';
import { minutesOfDay } from '../calendar/time-math';

/**
 * 一次 tick 产出的两个读数：墙钟分钟数（日历的「现在」线用）与 ISO 时刻
 * （领域层的 `isOverdue` / `quadrantOf` 用）。
 *
 * 为什么合成一个 hook：两者必须描述同一瞬间。若分钟数和 ISO 各开一个
 * interval，两个定时器对齐分钟边界的余量不同，边界上会差一拍 —— 行上已经
 * 显示「已过期」，卡片却还留在原象限。所以只保留一个定时器，两个读数都由
 * 同一份 ISO 派生。
 */
export interface NowReading {
  minute: number;
  instant: string;
}

/** 读一次时钟：分钟与 ISO 从同一个 ISO 字符串换算，保证描述同一瞬间。 */
function readNow(): NowReading {
  const iso = new Date().toISOString();
  return { minute: minutesOfDay(iso), instant: iso };
}

/**
 * Wall-clock minute-of-day in the app time zone, re-read on every minute
 * boundary while `active`. A single `setTimeout` aligned to the next minute
 * then a 60s interval keeps the tick from drifting, and the timer is cleared
 * on unmount. Inactive views schedule nothing.
 *
 * 中文补充：先 `setTimeout` 对齐到下一分钟边界、再切成 60s 周期，是为了让
 * tick 恰好落在分钟切换的那一刻，而不是从挂载时刻起算；否则「现在」会永远
 * 比真实墙钟滞后一个挂载余量。非激活的视图不排任何定时器。
 */
export function useNow(active: boolean): NowReading {
  const [now, setNow] = useState<NowReading>(readNow);

  useEffect(() => {
    if (!active) return;
    let interval: number | undefined;
    const tick = () => setNow(readNow());
    tick();
    const timeout = window.setTimeout(
      () => {
        tick();
        interval = window.setInterval(tick, 60_000);
      },
      60_000 - (Date.now() % 60_000),
    );
    return () => {
      window.clearTimeout(timeout);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, [active]);

  return now;
}

/**
 * 当前墙钟分钟数（0–1439）。
 *
 * 保留原签名与语义：日历的 NowLine 已有调用者，这次只是搬家，不改行为。
 */
export function useNowMinutes(active: boolean): number {
  return useNow(active).minute;
}

/**
 * 当前时刻的 ISO 字符串。`useNowMinutes` 已经算出分钟数，
 * 但领域层（isOverdue / quadrantOf）要的是 Instant，不是分钟。
 * 两者必须来自同一个 tick，否则行上的「已过期」和卡片的归属会差一分钟。
 *
 * 这个 hook 只给「只要时刻」的调用者一个窄接口；同一组件若同时需要分钟和
 * ISO，应直接调 `useNow`，不要再各调一个，免得退化成两个定时器。
 */
export function useNowInstant(active: boolean): string {
  return useNow(active).instant;
}
