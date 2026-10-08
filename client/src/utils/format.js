// 统一的金额/数字格式化工具 —— 全站复用，避免 toLocaleString / toFixed(0/2) 散落、缺 tabular-nums 的不一致。

// 金额（默认两位小数，千位分隔）
export function formatMoney(v) {
  return `¥${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// 金额（整数，千位分隔）—— 用于列表/概览等不需要小数的场景
export function formatMoneyInt(v) {
  return `¥${Number(v || 0).toLocaleString()}`;
}

// 普通数字（千位分隔，保留两位）
export function formatNumber(v) {
  return Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
