import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Tag, Button, Spin, Empty, message, Modal, Grid } from 'antd';
import {
  ArrowLeftOutlined, HeartOutlined, HeartFilled, EyeOutlined,
  PushpinFilled, SearchOutlined, LeftOutlined, RightOutlined,
} from '@ant-design/icons';
import api from '../api';

const { useBreakpoint } = Grid;

const C = {
  primary: 'var(--color-primary)',
  primaryLight: 'var(--kb-primary-light)',
  bg: 'var(--color-bg)',
  cardBg: 'var(--color-bg-white)',
  text: 'var(--kb-text)',
  textLight: 'var(--kb-text-muted)',
  textSecondary: 'var(--kb-text-secondary)',
  border: 'var(--kb-border)',
  tagBg: 'var(--kb-tag-bg)',
  tagText: 'var(--kb-tag-text)',
};

const DIFFICULTY_COLORS = {
  '入门': { bg: 'var(--kb-diff-begin-bg)', text: 'var(--kb-diff-begin-text)' },
  '进阶': { bg: 'var(--kb-diff-mid-bg)', text: 'var(--kb-diff-mid-text)' },
  '高级': { bg: 'var(--kb-diff-adv-bg)', text: 'var(--kb-diff-adv-text)' },
};

export default function KnowledgeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState(null);
  const [relatedNotes, setRelatedNotes] = useState([]);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const contentRef = useRef(null);

  const isMobile = !screens.md;

  useEffect(() => {
    setLoading(true);
    api.get(`/knowledge/detail/${id}`)
      .then(({ data }) => {
        setNote(data);
        // 加载相关笔记（同分类）
        if (data.category) {
          api.get('/knowledge', { params: { category: data.category, page: 1, page_size: 6 } })
            .then(({ data: d }) => setRelatedNotes(d.list.filter(n => n.id !== parseInt(id)).slice(0, 3)))
            .catch((err) => { console.error('加载相关笔记失败', err); message.error('加载相关笔记失败'); });
        }
      })
      .catch(err => {
        message.error(err.response?.data?.error || '加载失败');
      })
      .finally(() => setLoading(false));
  }, [id]);

  // 收藏
  const toggleFav = () => {
    api.post(`/knowledge/${id}/favorite`).then(({ data }) => {
      setNote(prev => ({ ...prev, is_favorited: data.favorited }));
      message.success(data.message);
    }).catch(() => message.error('操作失败'));
  };

  // 提取内容中的所有图片
  const images = note?.content_blocks?.filter(b => b.type === 'image').map(b => b.url) || [];
  // 如果没有内容图片，用封面图
  const allImages = images.length > 0 ? images : (note?.cover_image ? [note.cover_image] : []);

  // 图片预览
  const openPreview = (idx) => {
    setPreviewIndex(idx);
    setPreviewVisible(true);
  };

  const nextImage = (e) => {
    e?.stopPropagation();
    setPreviewIndex(prev => (prev + 1) % allImages.length);
  };

  const prevImage = (e) => {
    e?.stopPropagation();
    setPreviewIndex(prev => (prev - 1 + allImages.length) % allImages.length);
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg }}>
        <Spin />
      </div>
    );
  }

  if (!note) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg }}>
        <Empty description="笔记不存在" />
      </div>
    );
  }

  const diffColor = DIFFICULTY_COLORS[note.difficulty] || DIFFICULTY_COLORS['入门'];

  return (
    <div style={{ minHeight: '100vh', background: C.bg }}>
      {/* 顶部导航栏 */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: 'var(--kb-header-bg)', backdropFilter: 'blur(12px)',
        borderBottom: `1px solid ${C.border}`,
        padding: '10px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/knowledge')}
          style={{ fontSize: 16, color: C.text }}
        >
          返回
        </Button>
        <div style={{ fontSize: 14, color: C.textLight }}>知识库</div>
        <div className="w-xs" />
      </div>

      {/* 详情主体 */}
      <div style={{
        maxWidth: isMobile ? '100%' : 800,
        margin: '0 auto',
        background: C.cardBg,
        minHeight: 'calc(100vh - 52px)',
      }}>
        {/* 顶部图片轮播区 */}
        {allImages.length > 0 && (
          <div style={{
            position: 'relative',
            maxHeight: isMobile ? 400 : 500,
            overflow: 'hidden',
            background: C.primaryLight,
          }}>
            <div style={{
              display: 'flex', overflowX: 'auto', scrollSnapType: 'x mandatory',
              scrollbarWidth: 'none', msOverflowStyle: 'none',
            }}
            ref={contentRef}
            >
              {allImages.map((img, idx) => (
                <div
                  key={idx}
                  style={{
                    flex: '0 0 100%', scrollSnapAlign: 'center',
                    display: 'flex', justifyContent: 'center', alignItems: 'center',
                    background: C.primaryLight,
                  }}
                >
                  <img
                    src={img}
                    alt={`图片${idx + 1}`}
                    onClick={() => openPreview(idx)}
                    style={{
                      maxHeight: isMobile ? 400 : 500,
                      width: '100%', objectFit: 'contain',
                      cursor: 'zoom-in',
                    }}
                  />
                </div>
              ))}
            </div>
            {/* 图片计数 */}
            {allImages.length > 1 && (
              <div style={{
                position: 'absolute', bottom: 12, right: 12,
                background: 'rgba(0,0,0,0.5)', borderRadius: 12,
                padding: '2px 10px', fontSize: 12, color: '#fff',
              }}>
                1/{allImages.length}
              </div>
            )}
            {/* 轮播箭头（PC端） */}
            {allImages.length > 1 && !isMobile && (
              <>
                <div onClick={prevImage} style={{
                  position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                  background: 'rgba(0,0,0,0.3)', borderRadius: '50%', width: 40, height: 36,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', color: '#fff',
                }}>
                  <LeftOutlined />
                </div>
                <div onClick={nextImage} style={{
                  position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                  background: 'rgba(0,0,0,0.3)', borderRadius: '50%', width: 40, height: 36,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', color: '#fff',
                }}>
                  <RightOutlined />
                </div>
              </>
            )}
          </div>
        )}

        {/* 内容区 */}
        <div style={{ padding: isMobile ? '16px 16px 100px' : '24px 40px 100px' }}>
          {/* 标题 */}
          <h1 style={{
            fontSize: isMobile ? 20 : 24, fontWeight: 700, color: C.text,
            lineHeight: 1.4, marginBottom: 12,
          }}>
            {note.is_pinned && <PushpinFilled style={{ color: C.primary, marginRight: 8, fontSize: 18 }} />}
            {note.title}
          </h1>

          {/* 标签行 */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
            {note.category && (
              <Tag style={{ borderRadius: 12, background: C.tagBg, color: C.tagText, border: 'none', fontSize: 12 }}>
                {note.category}
              </Tag>
            )}
            {note.difficulty && (
              <Tag style={{ borderRadius: 12, background: diffColor.bg, color: diffColor.text, border: 'none', fontSize: 12 }}>
                {note.difficulty}
              </Tag>
            )}
            {note.product_tags?.map(t => (
              <Tag key={t} style={{ borderRadius: 12, background: 'var(--kb-chip-bg)', color: 'var(--kb-chip-text)', border: 'none', fontSize: 12 }}>
                {t}
              </Tag>
            ))}
            {note.selling_tags?.map(t => (
              <Tag key={t} style={{ borderRadius: 12, background: 'var(--kb-orange-bg)', color: 'var(--kb-orange-text)', border: 'none', fontSize: 12 }}>
                {t}
              </Tag>
            ))}
          </div>

          {/* 作者信息 */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            paddingBottom: 16, marginBottom: 20, borderBottom: `1px solid ${C.border}`,
          }}>
            <div style={{
              width: 40, height: 36, borderRadius: '50%',
              background: C.primaryLight, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: C.primary, fontWeight: 600, fontSize: 14,
            }}>
              {(note.author_name || '匿')[0]}
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{note.author_name || '匿名'}</div>
              <div style={{ fontSize: 12, color: C.textLight }}>
                {note.created_at?.slice(0, 10)} · <EyeOutlined style={{ marginRight: 3 }} />{note.view_count || 0} 次浏览
              </div>
            </div>
          </div>

          {/* 图文穿插内容 */}
          <div style={{ fontSize: 16, lineHeight: 1.9, color: C.text }}>
            {note.content_blocks?.map((block, idx) => {
              if (block.type === 'text') {
                return (
                  <p key={idx} style={{
                    marginBottom: 16, whiteSpace: 'pre-wrap',
                    fontSize: isMobile ? 15 : 16,
                    lineHeight: isMobile ? 1.8 : 1.9,
                  }}>
                    {block.content}
                  </p>
                );
              }
              if (block.type === 'image') {
                return (
                  <div key={idx} style={{ margin: '16px 0' }}>
                    <img
                      src={block.url}
                      alt=""
                      onClick={() => {
                        const imgIdx = allImages.indexOf(block.url);
                        if (imgIdx >= 0) openPreview(imgIdx);
                      }}
                      style={{
                        width: '100%', borderRadius: 12, cursor: 'zoom-in',
                        objectFit: 'cover',
                      }}
                    />
                    {block.caption && (
                      <div style={{ fontSize: 'var(--font-size-sm)', color: C.textLight, textAlign: 'center', marginTop: 6 }}>
                        {block.caption}
                      </div>
                    )}
                  </div>
                );
              }
              if (block.type === 'video') {
                return (
                  <div key={idx} style={{ margin: '16px 0' }}>
                    <video
                      src={block.url}
                      controls
                      playsInline
                      style={{ width: '100%', borderRadius: 12, background: '#000', display: 'block' }}
                    />
                    {block.caption && (
                      <div style={{ fontSize: 'var(--font-size-sm)', color: C.textLight, textAlign: 'center', marginTop: 6 }}>
                        {block.caption}
                      </div>
                    )}
                  </div>
                );
              }
              return null;
            })}
            {(!note.content_blocks || note.content_blocks.length === 0) && (
              <div style={{ color: C.textLight, textAlign: 'center', padding: '40px 0' }}>
                暂无详细内容
              </div>
            )}
          </div>

          {/* 相关笔记 */}
          {relatedNotes.length > 0 && (
            <div style={{ marginTop: 40, paddingTop: 20, borderTop: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: C.text, marginBottom: 16 }}>
                <SearchOutlined style={{ marginRight: 8, color: C.primary }} />
                相关笔记
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
                gap: 12,
              }}>
                {relatedNotes.map(rn => (
                  <div
                    key={rn.id}
                    onClick={() => { navigate(`/knowledge/detail/${rn.id}`); window.scrollTo(0, 0); }}
                    style={{
                      borderRadius: 12, overflow: 'hidden', cursor: 'pointer',
                      border: `1px solid ${C.border}`, background: C.cardBg,
                      transition: 'box-shadow 0.2s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 12px rgba(168,140,120,0.12)'}
                    onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
                  >
                    {rn.cover_image && (
                      <img src={rn.cover_image} alt="" style={{ width: '100%', height: 100, objectFit: 'cover' }} />
                    )}
                    <div style={{ padding: '8px 10px' }}>
                      <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: C.text,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {rn.title}
                      </div>
                      <div style={{ fontSize: 11, color: C.textLight, marginTop: 4 }}>
                        <EyeOutlined style={{ marginRight: 3 }} />{rn.view_count || 0}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 底部操作栏 */}
      <div style={{
        position: 'fixed', bottom: isMobile ? 52 : 0, left: 0, right: 0, zIndex: 100,
        background: 'var(--kb-header-bg)', backdropFilter: 'blur(12px)',
        borderTop: `1px solid ${C.border}`,
        padding: '10px 16px',
        display: 'flex', justifyContent: 'center', gap: 16,
        maxWidth: isMobile ? '100%' : 800,
        margin: '0 auto',
      }}>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/knowledge')}
          style={{ color: C.textSecondary, fontSize: 14 }}
        >
          返回信息流
        </Button>
        <Button
          type={note.is_favorited ? 'primary' : 'default'}
          icon={note.is_favorited ? <HeartFilled /> : <HeartOutlined />}
          onClick={toggleFav}
          style={{
            borderRadius: 20, padding: '0 24px',
            background: note.is_favorited ? '#FF6B6B' : undefined,
            borderColor: note.is_favorited ? '#FF6B6B' : C.border,
          }}
        >
          {note.is_favorited ? '已收藏' : '收藏'}
        </Button>
      </div>

      {/* 图片放大预览 */}
      <Modal
        open={previewVisible}
        onCancel={() => setPreviewVisible(false)}
        footer={null}
        width="100%"
        style={{ top: 0, maxWidth: '100vw', maxHeight: '100vh' }}
        styles={{ body: { padding: 0, background: 'rgba(0,0,0,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' } }}
        closable={false}
      >
        <div style={{ position: 'relative', width: '100%', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setPreviewVisible(false)}>
          <img src={allImages[previewIndex]} alt="" style={{ maxHeight: '90vh', maxWidth: '95vw', objectFit: 'contain' }} />
          {allImages.length > 1 && (
            <>
              <div onClick={prevImage} style={{
                position: 'absolute', left: 20, top: '50%', transform: 'translateY(-50%)',
                background: 'rgba(255,255,255,0.2)', borderRadius: '50%', width: 48, height: 44,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: '#fff', fontSize: 18,
              }}>
                <LeftOutlined />
              </div>
              <div onClick={nextImage} style={{
                position: 'absolute', right: 20, top: '50%', transform: 'translateY(-50%)',
                background: 'rgba(255,255,255,0.2)', borderRadius: '50%', width: 48, height: 44,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: '#fff', fontSize: 18,
              }}>
                <RightOutlined />
              </div>
              <div style={{
                position: 'absolute', bottom: 30, left: '50%', transform: 'translateX(-50%)',
                color: '#fff', fontSize: 14,
              }}>
                {previewIndex + 1} / {allImages.length}
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
