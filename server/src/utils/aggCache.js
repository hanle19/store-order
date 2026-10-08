// 轻量聚合缓存（仅用于「重聚合、只读」接口，如工作台 / 经营分析）
//
// 设计要点（两条都不能省，否则会出严重问题）：
//  1) 调用方必须把「角色 / 用户 / 门店 / 年月」等维度全部拼进 key。
//     少拼一个维度会让 A 用户看到 B 用户的数据（越权级事故）。
//  2) key 之外自动叠加「数据指纹」——订单 / 收款 / 明细 / 客户任一变动指纹即变，
//     缓存自动失效。这样无需在几十个写接口逐个埋点（漏埋 = 用户看到陈旧数据）。
//  3) TTL 仅作兜底，防止指纹未覆盖的变更（如直接改库）长期残留。
//
// 指纹查询本身是 4 条单行聚合，代价远小于被缓存的 20+ 条统计 SQL。

const TTL_MS = 30 * 1000; // 兜底 30 秒
const MAX_ENTRIES = 200;
const cache = new Map();

// 数据指纹：任一写操作都会改变其中至少一项
export function dataFingerprint(db) {
  try {
    const o = db.prepare('SELECT COUNT(*) AS c, COALESCE(MAX(updated_at), \'\') AS m FROM orders').get();
    const p = db.prepare('SELECT COUNT(*) AS c, COALESCE(MAX(created_at), \'\') AS m FROM payments').get();
    const i = db.prepare('SELECT COUNT(*) AS c, COALESCE(MAX(id), 0) AS m FROM order_items').get();
    const c = db.prepare('SELECT COUNT(*) AS c, COALESCE(MAX(updated_at), \'\') AS m FROM customers').get();
    return `${o.c}:${o.m}|${p.c}:${p.m}|${i.c}:${i.m}|${c.c}:${c.m}`;
  } catch {
    // 指纹取不到时返回唯一值：等价于「本次不缓存」，正确性优先于性能
    return `nocache:${Date.now()}:${Math.random()}`;
  }
}

// 命中返回 { value, fp }（fp 可直接回传给 set，省一次指纹查询）；未命中返回 undefined
export function get(db, key) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  const fp = dataFingerprint(db);
  if (hit.fp !== fp || Date.now() > hit.exp) {
    cache.delete(key);
    return undefined;
  }
  return { value: hit.value, fp };
}

export function set(db, key, value, fp) {
  cache.set(key, { value, fp: fp || dataFingerprint(db), exp: Date.now() + TTL_MS });
  // 简单的容量控制：超出上限时淘汰最早写入的一条
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

// 供「恢复出厂 / 备份还原」等破坏性操作调用
export function clear() {
  cache.clear();
}
