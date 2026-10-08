import { Router } from 'express';
import { getDb } from '../db.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { auditDelete, TARGET_TYPES } from '../utils/audit.js';

const router = Router();
router.use(authMiddleware);

// 分类常量
const CATEGORIES = ['商品品类', '产品系列', '销售话术', '售后知识点'];
const DIFFICULTIES = ['入门', '进阶', '高级'];

// 解析笔记行，将 JSON 字段转为对象
function parseNote(row) {
  if (!row) return null;
  const blocks = JSON.parse(row.content_blocks || '[]');
  return {
    ...row,
    content_blocks: blocks,
    has_video: Array.isArray(blocks) && blocks.some(b => b && b.type === 'video'),
    product_tags: JSON.parse(row.product_tags || '[]'),
    selling_tags: JSON.parse(row.selling_tags || '[]'),
    is_pinned: !!row.is_pinned,
  };
}

// 内容块是否含视频
function blocksHasVideo(contentBlocksJson) {
  try {
    const blocks = JSON.parse(contentBlocksJson || '[]');
    return Array.isArray(blocks) && blocks.some(b => b && b.type === 'video');
  } catch {
    return false;
  }
}

// ========== 导购阅览端 ==========

// 瀑布流列表（仅已发布）
router.get('/', (req, res) => {
  const db = getDb();
  const { search, category, difficulty, tag, page = 1, page_size = 20 } = req.query;
  // 分页钳制：SQLite 中负 LIMIT 表示「不限制」，可被用于一次拉全表，必须同时钳上下限
  const rawSize = parseInt(page_size);
  const limit = Math.min(50, Math.max(1, Number.isFinite(rawSize) && rawSize > 0 ? rawSize : 20));
  const offset = Math.max(0, (Math.max(1, parseInt(page) || 1) - 1)) * limit;

  let where = "WHERE status = 'published'";
  const params = [];

  if (search) {
    where += " AND (title LIKE ? OR product_tags LIKE ? OR selling_tags LIKE ?)";
    const kw = `%${search}%`;
    params.push(kw, kw, kw);
  }
  if (category) {
    where += " AND category = ?";
    params.push(category);
  }
  if (difficulty) {
    where += " AND difficulty = ?";
    params.push(difficulty);
  }
  if (tag) {
    where += " AND (product_tags LIKE ? OR selling_tags LIKE ?)";
    const tw = `%"${tag}"%`;
    params.push(tw, tw);
  }

  // 置顶优先，然后按创建时间倒序
  const order = "ORDER BY is_pinned DESC, created_at DESC";

  const total = db.prepare(`SELECT COUNT(*) as c FROM knowledge_notes ${where}`).get(...params).c;
  const rows = db.prepare(
    `SELECT id, title, cover_image, category, product_tags, selling_tags, difficulty,
       is_pinned, view_count, favorite_count, author_id, created_at, content_blocks
     FROM knowledge_notes ${where} ${order} LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  // 查作者名
  const authorIds = [...new Set(rows.map(r => r.author_id).filter(Boolean))];
  const authorMap = {};
  if (authorIds.length) {
    const placeholders = authorIds.map(() => '?').join(',');
    db.prepare(`SELECT id, display_name FROM users WHERE id IN (${placeholders})`).all(...authorIds)
      .forEach(u => { authorMap[u.id] = u.display_name; });
  }

  // 当前用户的收藏集合
  const favRows = db.prepare('SELECT note_id FROM knowledge_favorites WHERE user_id = ?').all(req.user.id);
  const favSet = new Set(favRows.map(r => r.note_id));

  const list = rows.map(r => {
    const { content_blocks, ...rest } = r;
    return {
      ...rest,
      product_tags: JSON.parse(r.product_tags || '[]'),
      selling_tags: JSON.parse(r.selling_tags || '[]'),
      is_pinned: !!r.is_pinned,
      author_name: authorMap[r.author_id] || '',
      is_favorited: favSet.has(r.id),
      has_video: blocksHasVideo(content_blocks),
    };
  });

  res.json({ list, total, page: parseInt(page), page_size: limit });
});

// 笔记详情
router.get('/detail/:id', (req, res) => {
  const db = getDb();
  const note = db.prepare('SELECT * FROM knowledge_notes WHERE id = ? AND status = ?').get(req.params.id, 'published');
  if (!note) return res.status(404).json({ error: '笔记不存在或已下架' });

  // 增加浏览量
  db.prepare('UPDATE knowledge_notes SET view_count = view_count + 1 WHERE id = ?').run(note.id);

  // 记录浏览历史
  db.prepare('DELETE FROM knowledge_views WHERE user_id = ? AND note_id = ?').run(req.user.id, note.id);
  db.prepare('INSERT INTO knowledge_views (user_id, note_id) VALUES (?, ?)').run(req.user.id, note.id);

  // 作者信息
  let author_name = '';
  if (note.author_id) {
    const author = db.prepare('SELECT display_name FROM users WHERE id = ?').get(note.author_id);
    author_name = author?.display_name || '';
  }

  // 是否收藏
  const fav = db.prepare('SELECT id FROM knowledge_favorites WHERE user_id = ? AND note_id = ?').get(req.user.id, note.id);

  res.json({ ...parseNote(note), author_name, is_favorited: !!fav });
});

// 收藏 / 取消收藏
router.post('/:id/favorite', (req, res) => {
  const db = getDb();
  const note = db.prepare('SELECT id FROM knowledge_notes WHERE id = ?').get(req.params.id);
  if (!note) return res.status(404).json({ error: '笔记不存在' });

  const existing = db.prepare('SELECT id FROM knowledge_favorites WHERE user_id = ? AND note_id = ?').get(req.user.id, note.id);
  if (existing) {
    db.prepare('DELETE FROM knowledge_favorites WHERE id = ?').run(existing.id);
    db.prepare('UPDATE knowledge_notes SET favorite_count = MAX(0, favorite_count - 1) WHERE id = ?').run(note.id);
    res.json({ favorited: false, message: '已取消收藏' });
  } else {
    db.prepare('INSERT INTO knowledge_favorites (user_id, note_id) VALUES (?, ?)').run(req.user.id, note.id);
    db.prepare('UPDATE knowledge_notes SET favorite_count = favorite_count + 1 WHERE id = ?').run(note.id);
    res.json({ favorited: true, message: '收藏成功' });
  }
});

// 我的收藏列表
router.get('/favorites', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT n.id, n.title, n.cover_image, n.category, n.product_tags, n.selling_tags,
           n.difficulty, n.is_pinned, n.view_count, n.favorite_count, n.created_at,
           n.content_blocks,
           f.created_at as favorited_at
    FROM knowledge_favorites f
    JOIN knowledge_notes n ON f.note_id = n.id
    WHERE f.user_id = ? AND n.status = 'published'
    ORDER BY f.created_at DESC
  `).all(req.user.id);

  const list = rows.map(r => {
    const { content_blocks, ...rest } = r;
    return {
      ...rest,
      product_tags: JSON.parse(r.product_tags || '[]'),
      selling_tags: JSON.parse(r.selling_tags || '[]'),
      is_pinned: !!r.is_pinned,
      is_favorited: true,
      has_video: blocksHasVideo(content_blocks),
    };
  });

  res.json({ list });
});

// 最近浏览
router.get('/recent', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT n.id, n.title, n.cover_image, n.category, n.product_tags, n.selling_tags,
           n.difficulty, n.is_pinned, n.view_count, n.favorite_count, n.created_at,
           n.content_blocks,
           v.viewed_at
    FROM knowledge_views v
    JOIN knowledge_notes n ON v.note_id = n.id
    WHERE v.user_id = ? AND n.status = 'published'
    ORDER BY v.viewed_at DESC
    LIMIT 30
  `).all(req.user.id);

  const list = rows.map(r => {
    const { content_blocks, ...rest } = r;
    return {
      ...rest,
      product_tags: JSON.parse(r.product_tags || '[]'),
      selling_tags: JSON.parse(r.selling_tags || '[]'),
      is_pinned: !!r.is_pinned,
      has_video: blocksHasVideo(content_blocks),
    };
  });

  res.json({ list });
});

// 获取所有标签（用于筛选）
router.get('/tags', (req, res) => {
  const db = getDb();
  const rows = db.prepare("SELECT product_tags, selling_tags FROM knowledge_notes WHERE status = 'published'").all();
  const tagSet = new Set();
  rows.forEach(r => {
    JSON.parse(r.product_tags || '[]').forEach(t => tagSet.add(t));
    JSON.parse(r.selling_tags || '[]').forEach(t => tagSet.add(t));
  });
  res.json({ tags: [...tagSet].sort(), categories: CATEGORIES, difficulties: DIFFICULTIES });
});

// ========== 管理员后台 ==========

// 管理列表（含草稿）
router.get('/admin', roleMiddleware('admin'), (req, res) => {
  const db = getDb();
  const { search, category, status, page = 1, page_size = 20 } = req.query;
  // 同上方列表：负 LIMIT 在 SQLite 中等于不限制，必须钳上下限
  const rawSize = parseInt(page_size);
  const limit = Math.min(50, Math.max(1, Number.isFinite(rawSize) && rawSize > 0 ? rawSize : 20));
  const offset = Math.max(0, (Math.max(1, parseInt(page) || 1) - 1)) * limit;

  let where = "WHERE 1=1";
  const params = [];

  if (search) {
    where += " AND title LIKE ?";
    params.push(`%${search}%`);
  }
  if (category) {
    where += " AND category = ?";
    params.push(category);
  }
  if (status) {
    where += " AND status = ?";
    params.push(status);
  }

  const total = db.prepare(`SELECT COUNT(*) as c FROM knowledge_notes ${where}`).get(...params).c;
  const rows = db.prepare(
    `SELECT * FROM knowledge_notes ${where} ORDER BY is_pinned DESC, created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  res.json({
    list: rows.map(parseNote),
    total,
    page: parseInt(page),
    page_size: limit,
  });
});

// 创建笔记
router.post('/admin', roleMiddleware('admin'), (req, res) => {
  const db = getDb();
  const { title, cover_image, content_blocks, category, product_tags, selling_tags, difficulty, status, scheduled_at } = req.body;

  if (!title?.trim()) return res.status(400).json({ error: '标题不能为空' });

  const result = db.prepare(`
    INSERT INTO knowledge_notes (title, cover_image, content_blocks, category, product_tags, selling_tags, difficulty, status, scheduled_at, author_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    title.trim(),
    cover_image || null,
    JSON.stringify(content_blocks || []),
    category || null,
    JSON.stringify(product_tags || []),
    JSON.stringify(selling_tags || []),
    difficulty || '入门',
    status || 'draft',
    scheduled_at || null,
    req.user.id
  );

  res.json({ id: result.lastInsertRowid, message: '创建成功' });
});

// 更新笔记
router.put('/admin/:id', roleMiddleware('admin'), (req, res) => {
  const db = getDb();
  const note = db.prepare('SELECT * FROM knowledge_notes WHERE id = ?').get(req.params.id);
  if (!note) return res.status(404).json({ error: '笔记不存在' });

  const { title, cover_image, content_blocks, category, product_tags, selling_tags, difficulty, status, scheduled_at } = req.body;

  db.prepare(`
    UPDATE knowledge_notes SET
      title = ?, cover_image = ?, content_blocks = ?, category = ?,
      product_tags = ?, selling_tags = ?, difficulty = ?,
      status = ?, scheduled_at = ?, updated_at = datetime('now','localtime')
    WHERE id = ?
  `).run(
    title?.trim() || note.title,
    cover_image !== undefined ? cover_image : note.cover_image,
    JSON.stringify(content_blocks || JSON.parse(note.content_blocks || '[]')),
    category !== undefined ? category : note.category,
    JSON.stringify(product_tags || JSON.parse(note.product_tags || '[]')),
    JSON.stringify(selling_tags || JSON.parse(note.selling_tags || '[]')),
    difficulty || note.difficulty,
    status || note.status,
    scheduled_at !== undefined ? scheduled_at : note.scheduled_at,
    req.params.id
  );

  res.json({ message: '更新成功' });
});

// 删除笔记
router.delete('/admin/:id', roleMiddleware('admin'), (req, res) => {
  const db = getDb();
  const note = db.prepare('SELECT id FROM knowledge_notes WHERE id = ?').get(req.params.id);
  if (!note) return res.status(404).json({ error: '笔记不存在' });

  db.transaction(() => {
    db.prepare('DELETE FROM knowledge_favorites WHERE note_id = ?').run(note.id);
    db.prepare('DELETE FROM knowledge_views WHERE note_id = ?').run(note.id);
    db.prepare('DELETE FROM knowledge_notes WHERE id = ?').run(note.id);
  })();

  auditDelete(req, TARGET_TYPES.KNOWLEDGE, note.id, note);
  res.json({ message: '删除成功' });
});

// 置顶 / 取消置顶
router.put('/admin/:id/pin', roleMiddleware('admin'), (req, res) => {
  const db = getDb();
  const note = db.prepare('SELECT id, is_pinned FROM knowledge_notes WHERE id = ?').get(req.params.id);
  if (!note) return res.status(404).json({ error: '笔记不存在' });

  db.prepare('UPDATE knowledge_notes SET is_pinned = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?')
    .run(note.is_pinned ? 0 : 1, note.id);

  res.json({ is_pinned: !note.is_pinned, message: !note.is_pinned ? '已置顶' : '已取消置顶' });
});

// 批量操作
router.put('/admin/batch', roleMiddleware('admin'), (req, res) => {
  const db = getDb();
  const { ids, action, value } = req.body;

  if (!ids?.length) return res.status(400).json({ error: '请选择笔记' });

  db.transaction(() => {
    for (const id of ids) {
      if (action === 'status') {
        db.prepare("UPDATE knowledge_notes SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(value, id);
      } else if (action === 'category') {
        db.prepare("UPDATE knowledge_notes SET category = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(value, id);
      } else if (action === 'delete') {
        db.prepare('DELETE FROM knowledge_favorites WHERE note_id = ?').run(id);
        db.prepare('DELETE FROM knowledge_views WHERE note_id = ?').run(id);
        db.prepare('DELETE FROM knowledge_notes WHERE id = ?').run(id);
      }
    }
  })();

  res.json({ message: `批量操作完成（${ids.length} 条）` });
});

export default router;
