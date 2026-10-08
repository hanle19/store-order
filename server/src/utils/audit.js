// server/src/utils/audit.js
// 敏感操作审计收口。
//
// 背景：此前只有 orders.js / aftersales.js 写 operation_logs，且连 orders 自己的
// `DELETE /:id`（物理删单）都漏了 —— 全系统 13 个删除端点 0 条审计，
// "这单谁删的 / 这笔钱谁改的"事后完全查不到。
//
// 设计取舍：
//   1. **审计是旁路**：写入失败只记 console.error，绝不能让业务请求失败（审计挂了不该拖垮下单）。
//   2. **类型白名单**：operation_logs.target_type 有 CHECK 约束，未登记的类型一律降级为 'other'，
//      避免新增实体时 CHECK 报错把业务打断。新增业务实体应同步扩展
//      utils/migrations.js 里 v2 的 CHECK 列表 + 本文件 TARGET_TYPES。
//   3. **details 截断**：单条上限 8KB，防止把整张宽表塞进审计字段。

import { getDb } from '../db.js';

export const TARGET_TYPES = {
  ORDER: 'order',
  PURCHASE: 'purchase',
  DELIVERY: 'delivery',
  PAYMENT: 'payment',
  INVENTORY: 'inventory',
  PRODUCT: 'product',
  PRODUCT_NAME: 'product_name',
  CUSTOMER: 'customer',
  FINANCE: 'finance',
  KNOWLEDGE: 'knowledge',
  COUPON: 'coupon',
  BUNDLE: 'bundle',
  DAILY: 'daily',
  DELIVERY_PERSON: 'delivery_person',
  USER: 'user',
  CONFIG: 'config',
  OTHER: 'other',
};

const ALLOWED = new Set(Object.values(TARGET_TYPES));
const MAX_DETAILS = 8 * 1024;

function stringifyDetails(details) {
  if (details == null) return '{}';
  let s;
  try {
    s = typeof details === 'string' ? details : JSON.stringify(details);
  } catch (e) {
    s = JSON.stringify({ _unserializable: String(e.message) });
  }
  return s.length > MAX_DETAILS ? `${s.slice(0, MAX_DETAILS)}…[truncated]` : s;
}

// 底层写入（与 orders.js 原 logOperation 语义一致，供已有调用平滑迁移）
export function logAudit(db, {
  targetType, targetId, action,
  operatorId = null, operatorName = '', reason = '',
  oldStatus = '', newStatus = '', details = null,
}) {
  const type = ALLOWED.has(targetType) ? targetType : TARGET_TYPES.OTHER;
  try {
    db.prepare(`INSERT INTO operation_logs
      (target_type, target_id, action, operator_id, operator_name, reason, old_status, new_status, details)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(type, Number(targetId) || 0, action || 'unknown', operatorId || null,
        operatorName || '', reason || '', oldStatus || '', newStatus || '',
        stringifyDetails(details));
    return true;
  } catch (e) {
    console.error(`[审计] 写入失败（不影响业务）：${type}/${targetId}/${action} — ${e.message}`);
    return false;
  }
}

// 从请求上下文取操作人后写入（路由里最常用）
export function auditFromReq(req, opts) {
  try {
    const db = getDb();
    return logAudit(db, {
      operatorId: req?.user?.id ?? null,
      operatorName: req?.user?.display_name || req?.user?.username || '',
      ...opts,
    });
  } catch (e) {
    console.error(`[审计] auditFromReq 失败（不影响业务）：${e.message}`);
    return false;
  }
}

// 删除类操作：统一 action='delete'，并把删除前的记录快照存进 details（删了就再也拿不到了）
export function auditDelete(req, targetType, targetId, before, extra = {}) {
  return auditFromReq(req, {
    targetType,
    targetId,
    action: 'delete',
    oldStatus: before?.status ?? '',
    newStatus: 'deleted',
    details: { before: before ?? null, ...extra },
  });
}

// 更新类操作：记录关键字段的前后值，便于回答"这笔金额是谁从多少改成多少的"
export function auditUpdate(req, targetType, targetId, { before, after, action = 'update', fields = null, reason = '', oldStatus = '', newStatus = '' } = {}) {
  const diff = {};
  if (before && after && fields?.length) {
    for (const f of fields) {
      if (String(before[f] ?? '') !== String(after[f] ?? '')) {
        diff[f] = { from: before[f] ?? null, to: after[f] ?? null };
      }
    }
  }
  return auditFromReq(req, {
    targetType,
    targetId,
    action,
    reason,
    oldStatus: oldStatus || String(before?.status ?? ''),
    newStatus: newStatus || String(after?.status ?? ''),
    details: { changed: diff, before: before ?? null },
  });
}
