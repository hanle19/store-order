// 门店数据隔离工具（v5.0 Phase 1）
// 设计：单店单仓时 store_id 全为 1，以下逻辑对单店是「恒真过滤」→ 零回归。
import { getDb } from '../db.js';

// 解析当前用户可访问的门店 id 列表
// - sales：仅自身 store_id（未设置则返回 []，由调用方用 1=0 兜底防泄漏）
// - admin/boss：若 ?store_id= 指定且 >0，限定该店；否则返回全部门店 id（看全部）
export function resolveStoreIds(req) {
  const user = req.user;
  if (!user) return [];
  if (user.role === 'sales') {
    return user.store_id ? [user.store_id] : [];
  }
  const requested = req.query && req.query.store_id ? parseInt(req.query.store_id, 10) : null;
  if (requested && requested > 0) return [requested];
  const db = getDb();
  const rows = db.prepare('SELECT id FROM stores').all();
  return rows.map(r => r.id);
}

// 把门店过滤追加到已构建的 where 片段（自动处理空 where 加 WHERE 前缀）
// alias：主表别名（如 'o' / 'c'）；params 按引用 push。scope 为空时返回 AND 1=0 防泄漏。
export function appendStoreFilter(where, params, alias, req) {
  const ids = resolveStoreIds(req);
  const clause = ids.length ? `${alias}.store_id IN (${ids.map(() => '?').join(',')})` : '1=0';
  for (const id of ids) params.push(id);
  if (!where || where.trim() === '') return `WHERE ${clause}`;
  return `${where} AND ${clause}`;
}

// 供内联子查询使用：返回 { clause: ' AND <alias>.store_id IN (?)', params: [...] }
// clause 以 ' AND ' 开头，可直接拼进已有 WHERE 内部；scope 为空时返回 AND 1=0。
export function storeClauseAndParams(req, alias = 'o') {
  const ids = resolveStoreIds(req);
  if (!ids.length) return { clause: ' AND 1=0', params: [] };
  return {
    clause: ` AND ${alias}.store_id IN (${ids.map(() => '?').join(',')})`,
    params: ids,
  };
}

// 写操作落店：sales 用自身店；admin/boss 用 body.store_id（缺省回退自身 store_id / 1）
export function resolveWriteStoreId(req) {
  const user = req.user;
  if (!user) return 1;
  if (user.role === 'sales') return user.store_id || 1;
  const body = req.body || {};
  const sid = parseInt(body.store_id, 10);
  if (sid && sid > 0) return sid;
  return user.store_id || 1;
}
