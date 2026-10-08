import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input, Tag, Drawer, Spin, message, Grid, Button, Select, Space } from 'antd';
import EmptyState from '../components/EmptyState';
import {
  SearchOutlined, HeartOutlined, HeartFilled, EyeOutlined,
  PushpinFilled, ClockCircleOutlined, AppstoreOutlined, ReadOutlined,
  FilterOutlined, ClearOutlined, VideoCameraOutlined,
} from '@ant-design/icons';
import api from '../api';

const { useBreakpoint } = Grid;

// ===== 设计令牌 — 语雀/Notion 风格 =====
const C = {
  primary: 'var(--color-primary)',
  primaryLight: 'var(--kb-primary-light)',
  bg: 'var(--color-bg)',
  cardBg: 'var(--color-bg-white)',
  text: 'var(--kb-text)',
  textSecondary: 'var(--kb-text-secondary)',
  textMuted: 'var(--kb-text-muted)',
  border: 'var(--kb-border)',
  borderLight: 'var(--color-border-light)',
};

const CATEGORIES = [
  { value: '全部', label: '全部品类' },
  { value: '商品品类', label: '商品品类' },
  { value: '产品系列', label: '产品系列' },
  { value: '销售话术', label: '销售话术' },
  { value: '售后知识点', label: '售后知识点' },
];
const DIFFICULTIES = [
  { value: '全部', label: '全部难度' },
  { value: '入门', label: '入门' },
  { value: '进阶', label: '进阶' },
  { value: '高级', label: '高级' },
];

const DIFFICULTY_STYLES = {
  '入门': { bg: 'var(--kb-diff-begin-bg)', text: 'var(--kb-diff-begin-text)' },
  '进阶': { bg: 'var(--kb-diff-mid-bg)', text: 'var(--kb-diff-mid-text)' },
  '高级': { bg: 'var(--kb-diff-adv-bg)', text: 'var(--kb-diff-adv-text)' },
};

// ===== 笔记卡片（独立组件）=====
function NoteCard({ note, onClick, onFav }) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const ds = DIFFICULTY_STYLES[note.difficulty] || DIFFICULTY_STYLES['入门'];

  // 合并所有标签用于展示
  const allTags = [
    ...(note.product_tags || []).map(t => ({ text: t, type: 'product' })),
    ...(note.selling_tags || []).map(t => ({ text: t, type: 'selling' })),
  ];

  return (
    <div
      onClick={onClick}
      style={{
        borderRadius: 14,
        overflow: 'hidden',
        background: C.cardBg,
        border: '1px solid transparent',
        cursor: 'pointer',
        transition: 'border-color 0.2s, transform 0.2s, box-shadow 0.25s',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = C.border;
        e.currentTarget.style.transform = 'translateY(-4px)';
        e.currentTarget.style.boxShadow = '0 8px 30px rgba(0,0,0,0.08)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'transparent';
        e.currentTarget.style.transform = '';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      {/* 封面图 — 3:4 比例 */}
      {note.cover_image && !imgError ? (
        <div style={{ position: 'relative', background: C.primaryLight, width: '100%', paddingTop: '133.33%', overflow: 'hidden' }}>
          {!imgLoaded && (
            <div style={{
              position: 'absolute', inset: 0,
              background: `linear-gradient(160deg, ${C.primaryLight} 0%, var(--kb-primary-light-2) 100%)`,
            }} />
          )}
          <img
            src={note.cover_image}
            alt=""
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)}
            style={{
              position: 'absolute', inset: 0,
              width: '100%', height: '100%', objectFit: 'cover',
              opacity: imgLoaded ? 1 : 0,
              transition: 'opacity 0.4s ease',
            }}
          />
          {note.is_pinned && (
            <div style={{
              position: 'absolute', top: 10, left: 10,
              background: 'var(--kb-header-bg-2)', borderRadius: 7,
              padding: '3px 10px', fontSize: 11, fontWeight: 600,
              color: C.primary, display: 'flex', alignItems: 'center', gap: 4,
              backdropFilter: 'blur(8px)', boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
            }}>
              <PushpinFilled style={{ fontSize: 10 }} />置顶
            </div>
          )}
          {note.has_video && (
            <div style={{
              position: 'absolute', top: 10, right: 10,
              background: 'rgba(0,0,0,0.55)', borderRadius: 7,
              padding: '3px 8px', fontSize: 11, fontWeight: 600,
              color: '#fff', display: 'flex', alignItems: 'center', gap: 4,
              backdropFilter: 'blur(8px)',
            }}>
              <VideoCameraOutlined style={{ fontSize: 10 }} />视频
            </div>
          )}
        </div>
      ) : (
        /* 无封面时的占位 */
        <div style={{
          width: '100%', paddingTop: '133.33%', position: 'relative',
          background: `linear-gradient(160deg, ${C.primaryLight} 0%, var(--kb-primary-light-2) 100%)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: 20,
          }}>
            <AppstoreOutlined style={{ fontSize: 36, color: C.primary, opacity: 0.3, marginBottom: 8 }} />
            <div style={{ fontSize: 'var(--font-size-sm)', color: C.primary, opacity: 0.5, textAlign: 'center', lineHeight: 1.5 }}>
              {note.title?.slice(0, 20)}
            </div>
          </div>
          {note.is_pinned && (
            <div style={{
              position: 'absolute', top: 10, left: 10,
              background: 'var(--kb-header-bg-2)', borderRadius: 7,
              padding: '3px 10px', fontSize: 11, fontWeight: 600,
              color: C.primary, display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <PushpinFilled style={{ fontSize: 10 }} />置顶
            </div>
          )}
          {note.has_video && (
            <div style={{
              position: 'absolute', top: 10, right: 10,
              background: 'rgba(0,0,0,0.55)', borderRadius: 7,
              padding: '3px 8px', fontSize: 11, fontWeight: 600,
              color: '#fff', display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <VideoCameraOutlined style={{ fontSize: 10 }} />视频
            </div>
          )}
        </div>
      )}

      {/* 信息区 */}
      <div style={{ padding: '16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* 标题 */}
        <div style={{
          fontSize: 16, fontWeight: 600, color: C.text,
          lineHeight: 1.45, marginBottom: 10,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          overflow: 'hidden', wordBreak: 'break-word',
          letterSpacing: '-0.2px',
        }}>
          {note.title}
        </div>

        {/* 标签行 — 展示所有标签 */}
        {allTags.length > 0 && (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
            {note.category && (
              <span style={{
                fontSize: 12, lineHeight: '18px', padding: '0 7px',
                borderRadius: 4, background: C.primaryLight, color: C.primary,
                fontWeight: 500,
              }}>
                {note.category}
              </span>
            )}
            {note.difficulty && (
              <span style={{
                fontSize: 12, lineHeight: '18px', padding: '0 7px',
                borderRadius: 4, background: ds.bg, color: ds.text,
                fontWeight: 500,
              }}>
                {note.difficulty}
              </span>
            )}
            {allTags.slice(0, 3).map(t => (
              <span key={t.text} style={{
                fontSize: 12, lineHeight: '18px', padding: '0 7px',
                borderRadius: 4,
                background: t.type === 'selling' ? 'var(--kb-sell-bg)' : 'var(--kb-prod-bg)',
                color: t.type === 'selling' ? 'var(--kb-sell-text)' : 'var(--kb-text-muted)',
                fontWeight: 500,
              }}>
                {t.text}
              </span>
            ))}
            {allTags.length > 3 && (
              <span style={{ fontSize: 10, color: C.textMuted, lineHeight: '18px' }}>
                +{allTags.length - 3}
              </span>
            )}
          </div>
        )}

        {/* 底部数据行 */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          paddingTop: 10, borderTop: `1px solid ${C.borderLight}`,
          marginTop: 'auto',
        }}>
          <span style={{ fontSize: 12, color: C.textMuted }}>
            <EyeOutlined style={{ marginRight: 3, fontSize: 11 }} />
            {note.view_count || 0}
          </span>
          <span
            onClick={(e) => onFav(note.id, e)}
            style={{
              fontSize: 12, color: note.is_favorited ? 'var(--color-error)' : 'var(--color-text-tertiary)',
              display: 'inline-flex', alignItems: 'center', gap: 3,
              cursor: 'pointer', padding: '2px 6px', borderRadius: 4,
              transition: 'background 0.15s', userSelect: 'none',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--color-error-bg)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            {note.is_favorited ? <HeartFilled /> : <HeartOutlined style={{ fontSize: 11 }} />}
            {note.favorite_count || 0}
          </span>
        </div>
      </div>
    </div>
  );
}

// ===== 主页面 =====
export default function KnowledgeFeed() {
  const screens = useBreakpoint();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [list, setList] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('全部');
  const [difficulty, setDifficulty] = useState('全部');
  const [activeTag, setActiveTag] = useState('');
  const [allTags, setAllTags] = useState([]);
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [favList, setFavList] = useState([]);
  const [recentList, setRecentList] = useState([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerType, setDrawerType] = useState('favorites');
  const [hasMore, setHasMore] = useState(true);

  const isMobile = !screens.md;

  // 加载列表（依赖 search / category / difficulty / activeTag）
  const loadList = useCallback((pageNum = 1, append = false) => {
    setLoading(true);
    const params = { page: pageNum, page_size: 24 };
    if (search) params.search = search;
    if (category !== '全部') params.category = category;
    if (difficulty !== '全部') params.difficulty = difficulty;
    if (activeTag) params.tag = activeTag;

    api.get('/knowledge', { params })
      .then(({ data }) => {
        if (append) {
          setList(prev => [...prev, ...data.list]);
        } else {
          setList(data.list);
        }
        setTotal(data.total);
        setHasMore((append ? 0 : 0) + data.list.length >= 24 && data.list.length === 24);
      })
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  }, [search, category, difficulty, activeTag]);

  // 初始加载标签列表
  useEffect(() => {
    api.get('/knowledge/tags').then(({ data }) => setAllTags(data.tags || [])).catch((err) => { console.error('加载标签失败', err); message.error('加载知识标签失败'); });
  }, []);

  // 筛选变化时重新加载
  useEffect(() => {
    setPage(1);
    loadList(1, false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [loadList]);

  // 滚动加载更多
  const handleScroll = useCallback(() => {
    if (loading || !hasMore) return;
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollHeight = document.documentElement.scrollHeight;
    const clientHeight = window.innerHeight;
    if (scrollHeight - scrollTop - clientHeight < 400) {
      const next = page + 1;
      setPage(next);
      loadList(next, true);
    }
  }, [loading, hasMore, page, loadList]);

  useEffect(() => {
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // 搜索去抖
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // 收藏
  const toggleFav = (noteId, e) => {
    e?.stopPropagation();
    api.post(`/knowledge/${noteId}/favorite`).then(({ data }) => {
      setList(prev => prev.map(n => n.id === noteId ? {
        ...n, is_favorited: data.favorited,
        favorite_count: data.favorited ? n.favorite_count + 1 : n.favorite_count - 1,
      } : n));
    }).catch(() => message.error('操作失败'));
  };

  const openFavorites = () => {
    setDrawerType('favorites');
    api.get('/knowledge/favorites').then(({ data }) => {
      setFavList(data.list || []);
      setDrawerOpen(true);
    }).catch((err) => { console.error('加载收藏失败', err); message.error('加载收藏失败'); });
  };

  const openRecent = () => {
    setDrawerType('recent');
    api.get('/knowledge/recent').then(({ data }) => {
      setRecentList(data.list || []);
      setDrawerOpen(true);
    }).catch((err) => { console.error('加载最近浏览失败', err); message.error('加载最近浏览失败'); });
  };

  const clearFilters = () => {
    setSearchInput('');
    setSearch('');
    setCategory('全部');
    setDifficulty('全部');
    setActiveTag('');
    setTagsExpanded(false);
  };

  const hasFilters = search || category !== '全部' || difficulty !== '全部' || activeTag;

  // 可见标签数
  const visibleTagCount = isMobile ? 8 : (tagsExpanded ? allTags.length : 20);

  const drawerList = drawerType === 'favorites' ? favList : recentList;

  // 列数根据屏幕宽度自适应（移动端 2 列）
  const colCount = isMobile ? 2
    : screens.xxl ? 6
    : screens.xl ? 5
    : screens.lg ? 4
    : screens.md ? 3
    : 2;

  return (
    <div style={{ minHeight: '100vh', background: C.bg }}>
      {/* ===== 顶部栏 — 无 maxWidth 限制，全宽 ===== */}
      <div style={{
        background: 'var(--kb-header-bg-2)',
        backdropFilter: 'blur(20px)',
        borderBottom: `1px solid ${C.border}`,
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{
          padding: isMobile ? '16px 16px 8px' : '16px 32px 16px',
        }}>
          {/* 标题行 */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: isMobile ? 8 : 16,
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
              <h1 style={{
                fontSize: isMobile ? 18 : 24, fontWeight: 700,
                color: C.text, margin: 0, letterSpacing: '-0.5px',
              }}>
                知识库
              </h1>
              {total > 0 && (
                <span style={{ fontSize: 'var(--font-size-sm)', color: C.textMuted, fontWeight: 400 }}>
                  共 {total} 篇
                </span>
              )}
            </div>
            <Space size={4}>
              <Button type="text" icon={<HeartOutlined />} onClick={openFavorites}
                style={{ color: C.textSecondary, fontSize: 'var(--font-size-sm)', borderRadius: 8 }}>
                {!isMobile && '收藏夹'}
              </Button>
              <Button type="text" icon={<ClockCircleOutlined />} onClick={openRecent}
                style={{ color: C.textSecondary, fontSize: 'var(--font-size-sm)', borderRadius: 8 }}>
                {!isMobile && '浏览记录'}
              </Button>
            </Space>
          </div>

          {/* 搜索 + 筛选行 */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Input
              placeholder="搜索标题、标签、关键词..."
              prefix={<SearchOutlined style={{ color: C.textMuted, fontSize: 15 }} />}
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              allowClear
              style={{
                flex: '1 1 280px', minWidth: 184, maxWidth: 560,
                height: 42, borderRadius: 10, fontSize: 14,
              }}
            />
            <Select value={category} onChange={setCategory}
              style={{ width: isMobile ? 105 : 125, height: 42, borderRadius: 10 }}
              options={CATEGORIES.map(c => ({ value: c.value, label: c.label }))} />
            <Select value={difficulty} onChange={setDifficulty}
              style={{ width: isMobile ? 105 : 125, height: 42, borderRadius: 10 }}
              options={DIFFICULTIES.map(d => ({ value: d.value, label: d.label }))} />
            {hasFilters && (
              <Button icon={<ClearOutlined />} onClick={clearFilters}
                type="text" size="small"
                style={{ color: C.textMuted, fontSize: 12, borderRadius: 8 }}>
                {!isMobile && '清除'}
              </Button>
            )}
          </div>

          {/* 标签云 */}
          {allTags.length > 0 && (
            <div className={isMobile ? 'knowledge-tag-rail' : undefined} style={{
              marginTop: 16, display: 'flex', gap: 8,
              flexWrap: isMobile ? 'nowrap' : 'wrap',
              overflowX: isMobile ? 'auto' : 'visible',
              alignItems: 'center',
            }}>
              {allTags.slice(0, visibleTagCount).map(tag => (
                <span
                  key={tag}
                  onClick={() => setActiveTag(activeTag === tag ? '' : tag)}
                  style={{
                    display: 'inline-block',
                    flexShrink: 0,
                    padding: '4px 12px', fontSize: 12, lineHeight: '20px',
                    borderRadius: 16, cursor: 'pointer',
                    background: activeTag === tag ? C.primary : 'var(--kb-chip-bg)',
                    color: activeTag === tag ? '#fff' : C.textSecondary,
                    fontWeight: activeTag === tag ? 600 : 400,
                    transition: 'all 0.2s',
                    userSelect: 'none',
                  }}
                >
                  {tag}
                </span>
              ))}
              {allTags.length > visibleTagCount && (
                <Button type="link"
                  onClick={() => setTagsExpanded(!tagsExpanded)}
                  style={{ fontSize: 12, padding: '0 4px', height: 26, color: C.textMuted }}>
                  {tagsExpanded ? '收起' : `+${allTags.length - visibleTagCount} 更多`}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ===== 瀑布流内容区 — 无 maxWidth，全宽 ===== */}
      <div style={{ padding: isMobile ? '8px 16px 80px' : '24px 32px 80px' }}>
        {loading && list.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '120px 0' }}>
            <Spin />
            <div style={{ marginTop: 16, fontSize: 16, color: C.textMuted }}>加载中...</div>
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            title={hasFilters ? '没有匹配的笔记' : '还没有笔记内容'}
            description={hasFilters ? '试试调整筛选条件，或清除当前筛选' : '前往知识库添加第一篇笔记'}
          />
        ) : (
          <>
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))`,
              gap: isMobile ? 8 : 20,
              alignItems: 'stretch',
            }}>
              {list.map(note => (
                <NoteCard
                  key={note.id}
                  note={note}
                  onClick={() => navigate(`/knowledge/detail/${note.id}`)}
                  onFav={toggleFav}
                />
              ))}
            </div>

            {loading && list.length > 0 && (
              <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <Spin />
              </div>
            )}
            {!loading && !hasMore && list.length > 0 && (
              <div style={{
                textAlign: 'center', padding: '48px 0 32px',
                color: C.textMuted, fontSize: 'var(--font-size-sm)',
              }}>
                — 已展示全部内容 —
              </div>
            )}
          </>
        )}
      </div>

      {/* ===== 收藏夹/浏览记录 ===== */}
      <Drawer
        title={
          <span style={{ fontSize: 16, fontWeight: 600, color: C.text }}>
            {drawerType === 'favorites' ? '我的收藏' : '最近浏览'}
          </span>
        }
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={isMobile ? '100%' : 420}
        styles={{ body: { padding: 0, background: C.bg } }}
      >
        {drawerList.length === 0 ? (
          <EmptyState
            title={drawerType === 'favorites' ? '还没有收藏笔记' : '还没有浏览记录'}
            description={drawerType === 'favorites' ? '去知识库收藏感兴趣的笔记' : '去知识库浏览笔记内容'}
          />
        ) : (
          <div style={{ padding: 16 }}>
            {drawerList.map(note => (
              <div
                key={note.id}
                onClick={() => { setDrawerOpen(false); navigate(`/knowledge/detail/${note.id}`); }}
                style={{
                  display: 'flex', gap: 12, marginBottom: 10, cursor: 'pointer',
                  background: C.cardBg, borderRadius: 12, padding: 12,
                  border: `1px solid ${C.borderLight}`,
                  transition: 'box-shadow 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.06)'}
                onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
              >
                {note.cover_image ? (
                  <img src={note.cover_image} alt=""
                    style={{ width: 64, height: 80, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                ) : (
                  <div style={{
                    width: 64, height: 80, borderRadius: 8, flexShrink: 0,
                    background: C.primaryLight, display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <AppstoreOutlined style={{ fontSize: 18, color: C.primary, opacity: 0.4 }} />
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 8, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <div style={{
                    fontWeight: 600, fontSize: 'var(--font-size-sm)', color: C.text, marginBottom: 4,
                    overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box',
                    WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                  }}>
                    {note.title}
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
                    {note.category && (
                      <span style={{
                        fontSize: 10, padding: '0 6px', borderRadius: 'var(--radius-sm)',
                        background: C.primaryLight, color: C.primary, lineHeight: '20px',
                      }}>{note.category}</span>
                    )}
                    {note.difficulty && (
                      <span style={{
                        fontSize: 10, padding: '0 6px', borderRadius: 'var(--radius-sm)',
                        background: (DIFFICULTY_STYLES[note.difficulty] || DIFFICULTY_STYLES['入门']).bg,
                        color: (DIFFICULTY_STYLES[note.difficulty] || DIFFICULTY_STYLES['入门']).text,
                        lineHeight: '20px',
                      }}>{note.difficulty}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: C.textMuted }}>
                    <EyeOutlined style={{ marginRight: 3 }} />{note.view_count || 0}
                    <HeartOutlined style={{ marginLeft: 10, marginRight: 3 }} />{note.favorite_count || 0}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Drawer>
    </div>
  );
}
