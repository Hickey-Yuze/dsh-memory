// dsh-memory — 完整 5 段 cron 表达式解析器（零依赖）。
// 字段顺序：分 时 日 月 周（周 0=周日 7=周日）。
// 支持：* / 数字区间（a-b）/ 步长（*/n、a-b/n）/ 离散值（a,b,c）。
// 语义对齐标准 cron：日与月字段「或」关系（某条规则日/月同时受限时任一匹配即触发），
// 周与日同时受限时也按标准 cron 的「或」处理（避免 0 0 * * 0 这类常用表达式失效）。

const FIELDS = 5;

/** 单字段解析：返回 { values: Set<number>, wildcard: boolean }；非法字段抛错。 */
function parseField(raw, min, max, name) {
  const value = String(raw == null ? '' : raw).trim();
  if (!value) throw new Error(`cron 字段「${name}」为空`);
  const out = new Set();
  let wildcard = false;
  for (const part of value.split(',')) {
    const p = part.trim();
    if (!p) continue;
    const m = /^(?:(\*)|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(p);
    if (!m) throw new Error(`cron 字段「${name}」无法解析：${part}`);
    const all = m[1] !== undefined;
    let lo = all ? min : Number(m[2]);
    let hi = all ? max : m[3] !== undefined ? Number(m[3]) : lo;
    const step = m[4] !== undefined ? Number(m[4]) : 1;
    if (step < 1) throw new Error(`cron 字段「${name}」步长非法：${part}`);
    if (lo < min || hi > max || lo > hi) throw new Error(`cron 字段「${name}」越界：${part}`);
    if (all && m[4] === undefined) wildcard = true; // 纯 * 才算通配；*/n 不是
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return { values: out, wildcard };
}

/**
 * 解析完整 5 段 cron 表达式。
 * 返回 { minutes, hours, days, months, weekdays, dayWild, weekdayWild }，
 * 或 null（空表达式 = 未启用）。非法表达式抛 Error。
 */
export function parseCron(expr) {
  const value = String(expr == null ? '' : expr).trim();
  if (!value) return null;
  const parts = value.split(/\s+/);
  if (parts.length !== FIELDS) {
    throw new Error(`cron 表达式必须 5 段（分 时 日 月 周），实际 ${parts.length} 段：${value}`);
  }
  const minutes = parseField(parts[0], 0, 59, '分');
  const hours = parseField(parts[1], 0, 23, '时');
  const days = parseField(parts[2], 1, 31, '日');
  const months = parseField(parts[3], 1, 12, '月');
  const weekdays = parseField(parts[4], 0, 7, '周');
  return {
    minutes: minutes.values,
    hours: hours.values,
    days: days.values,
    months: months.values,
    weekdays: weekdays.values,
    dayWild: days.wildcard,
    weekdayWild: weekdays.wildcard,
  };
}

/** 判断某个时间点是否命中表达式（日/周按 cron 的「或」语义，只在一个字段受限时按该字段）。 */
export function cronMatches(spec, date) {
  const d = new Date(date);
  if (!spec.minutes.has(d.getMinutes())) return false;
  if (!spec.hours.has(d.getHours())) return false;
  if (!spec.months.has(d.getMonth() + 1)) return false;
  const dayHit = spec.days.has(d.getDate());
  const wd = d.getDay() === 0 ? 0 : d.getDay(); // 周 7 归一到 0（周日）
  const wdHit = spec.weekdays.has(wd) || spec.weekdays.has(7);
  if (!spec.dayWild && !spec.weekdayWild) return dayHit || wdHit; // 都受限：或
  if (!spec.dayWild) return dayHit;                                // 只限日
  if (!spec.weekdayWild) return wdHit;                             // 只限周
  return true;                                                     // 都不限
}

/**
 * 计算下一次触发时间（面板展示「下次运行」）。
 * 从 after（默认 now）开始向后找第一个命中分钟。
 * 返回时间戳或 null（表达式永不触发——例如「2 月 30 日」）。
 */
export function nextRun(spec, after = Date.now()) {
  const d = new Date(after);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1); // 从下一分钟起找
  const deadline = d.getTime() + 5 * 365 * 24 * 3600 * 1000; // 最多扫 5 年
  while (d.getTime() < deadline) {
    if (cronMatches(spec, d)) return d.getTime();
    d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}
