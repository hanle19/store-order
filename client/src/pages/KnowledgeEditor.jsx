import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button, Input, Select, Tag, Space, Upload, message, Spin, Switch,
  DatePicker, Modal, Row, Col, Card, Divider, Grid,
} from 'antd';
import {
  ArrowLeftOutlined, PictureOutlined, FileTextOutlined, DeleteOutlined,
  ArrowUpOutlined, ArrowDownOutlined, PlusOutlined, SaveOutlined,
  CloudUploadOutlined, ClockCircleOutlined, InboxOutlined, VideoCameraOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../api';

const { useBreakpoint } = Grid;
const { TextArea } = Input;

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
  shadow: '0 2px 12px rgba(168, 140, 120, 0.08)',
};

const CATEGORIES = ['商品品类', '产品系列', '销售话术', '售后知识点'];
const DIFFICULTIES = ['入门', '进阶', '高级'];

export default function KnowledgeEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isEdit = !!id;
  const isMobile = !screens.md;

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [coverImage, setCoverImage] = useState('');
  const [blocks, setBlocks] = useState([]); // [{type:'text', content:''}, {type:'image', url:'', caption:''}]
  const [category, setCategory] = useState('');
  const [difficulty, setDifficulty] = useState('入门');
  const [productTags, setProductTags] = useState([]);
  const [sellingTags, setSellingTags] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [sellingTagInput, setSellingTagInput] = useState('');
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleTime, setScheduleTime] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [titleWidth, setTitleWidth] = useState(0);

  // 加载已有笔记
  useEffect(() => {
    if (!isEdit) return;
    api.get(`/knowledge/admin`, { params: { page: 1, page_size: 200 } })
      .then(({ data }) => {
        const note = data.list.find(n => n.id === parseInt(id));
        if (!note) {
          message.error('笔记不存在');
          navigate('/knowledge/admin');
          return;
        }
        setTitle(note.title);
        setCoverImage(note.cover_image || '');
        setBlocks(note.content_blocks || []);
        setCategory(note.category || '');
        setDifficulty(note.difficulty || '入门');
        setProductTags(note.product_tags || []);
        setSellingTags(note.selling_tags || []);
        if (note.scheduled_at) {
          setScheduleEnabled(true);
          setScheduleTime(dayjs(note.scheduled_at));
        }
      })
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  }, [id]);

  // 测量标题宽度，实现输入框自适应
  useEffect(() => {
    const span = document.createElement('span');
    span.style.cssText =
      'position:absolute;visibility:hidden;white-space:pre;' +
      'font-size:18px;font-weight:600;' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
      'padding:4px 11px;';
    span.textContent = title || '写一个吸引人的标题...';
    document.body.appendChild(span);
    const w = span.offsetWidth;
    document.body.removeChild(span);
    setTitleWidth(Math.min(Math.max(w + 40, 200), 860));
  }, [title]);

  // 图片上传
  const uploadImage = (file, callback) => {
    setUploading(true);
    const formData = new FormData();
    formData.append('image', file);
    api.post('/upload/image?target=knowledge', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(({ data }) => {
      callback(data.url);
    }).catch(() => {
      message.error('图片上传失败');
    }).finally(() => setUploading(false));
    return false; // 阻止 antd 默认上传
  };

  // 封面上传
  const handleCoverUpload = (file) => {
    uploadImage(file, (url) => {
      setCoverImage(url);
      message.success('封面上传成功');
    });
    return false;
  };

  // 添加文本块
  const addTextBlock = () => {
    setBlocks(prev => [...prev, { type: 'text', content: '' }]);
  };

  // 添加图片块
  const addImageBlock = (file) => {
    uploadImage(file, (url) => {
      setBlocks(prev => [...prev, { type: 'image', url, caption: '' }]);
    });
    return false;
  };

  // 视频上传
  const uploadVideo = (file, callback) => {
    setUploading(true);
    const formData = new FormData();
    formData.append('video', file);
    api.post('/upload/video', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(({ data }) => {
      callback(data.url);
    }).catch(err => {
      message.error(err.response?.data?.error || '视频上传失败');
    }).finally(() => setUploading(false));
    return false; // 阻止 antd 默认上传
  };

  // 添加视频块
  const addVideoBlock = (file) => {
    uploadVideo(file, (url) => {
      setBlocks(prev => [...prev, { type: 'video', url, caption: '' }]);
    });
    return false;
  };

  // 更新块内容
  const updateBlock = (idx, field, value) => {
    setBlocks(prev => prev.map((b, i) => i === idx ? { ...b, [field]: value } : b));
  };

  // 删除块
  const removeBlock = (idx) => {
    setBlocks(prev => prev.filter((_, i) => i !== idx));
  };

  // 移动块
  const moveBlock = (idx, dir) => {
    setBlocks(prev => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  // 添加标签
  const addProductTag = () => {
    const t = tagInput.trim();
    if (t && !productTags.includes(t)) {
      setProductTags(prev => [...prev, t]);
    }
    setTagInput('');
  };

  const addSellingTag = () => {
    const t = sellingTagInput.trim();
    if (t && !sellingTags.includes(t)) {
      setSellingTags(prev => [...prev, t]);
    }
    setSellingTagInput('');
  };

  // 保存
  const handleSave = (status) => {
    if (!title.trim()) {
      message.warning('请输入标题');
      return;
    }

    // 过滤空文本块
    const cleanBlocks = blocks.filter(b => {
      if (b.type === 'text') return b.content.trim();
      return !!b.url;
    });

    if (status === 'published' && !coverImage && cleanBlocks.length === 0) {
      message.warning('发布前请至少添加封面图或内容');
      return;
    }

    setSaving(true);
    const payload = {
      title: title.trim(),
      cover_image: coverImage || null,
      content_blocks: cleanBlocks,
      category: category || null,
      product_tags: productTags,
      selling_tags: sellingTags,
      difficulty,
      status,
      scheduled_at: scheduleEnabled && scheduleTime ? scheduleTime.format('YYYY-MM-DD HH:mm:ss') : null,
    };

    const request = isEdit
      ? api.put(`/knowledge/admin/${id}`, payload)
      : api.post('/knowledge/admin', payload);

    request.then(() => {
      message.success(status === 'draft' ? '草稿已保存' : status === 'published' ? '发布成功' : '已保存');
      navigate('/knowledge/admin');
    }).catch(err => {
      message.error(err.response?.data?.error || '保存失败');
    }).finally(() => setSaving(false));
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg }}>
        <Spin />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, paddingBottom: 80 }}>
      {/* 顶部栏 */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: 'var(--kb-header-bg)', backdropFilter: 'blur(12px)',
        borderBottom: `1px solid ${C.border}`,
        padding: '10px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/knowledge/admin')}>
          返回管理
        </Button>
        <span style={{ fontSize: 15, fontWeight: 600, color: C.text }}>
          {isEdit ? '编辑笔记' : '新建笔记'}
        </span>
        <Space>
          <Button icon={<SaveOutlined />} loading={saving} onClick={() => handleSave('draft')}>存草稿</Button>
          <Button type="primary" icon={<CloudUploadOutlined />} loading={saving}
            onClick={() => handleSave('published')}
            style={{ background: C.primary, borderColor: C.primary }}>
            发布
          </Button>
        </Space>
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: screens.md ? '24px 16px' : '12px' }}>
        {/* 封面上传 */}
        <Card size="small" style={{ marginBottom: 16, borderRadius: 12 }}>
          <div style={{ marginBottom: 8, fontWeight: 600, color: C.text }}>封面图</div>
          {coverImage ? (
            <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden' }}>
              <img src={coverImage} alt="封面" style={{ width: '100%', maxHeight: 240, objectFit: 'cover' }} />
              <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 8 }}>
                <Upload beforeUpload={handleCoverUpload} showUploadList={false}>
                  <Button icon={<PictureOutlined />} style={{ background: 'var(--kb-header-bg-2)' }}>更换</Button>
                </Upload>
                <Button danger icon={<DeleteOutlined />}
                  style={{ background: 'var(--kb-header-bg-2)' }}
                  onClick={() => setCoverImage('')} />
              </div>
            </div>
          ) : (
            <Upload.Dragger
              beforeUpload={handleCoverUpload}
              showUploadList={false}
              style={{ borderRadius: 12, background: C.primaryLight, border: `2px dashed ${C.primary}` }}
            >
              <div style={{ padding: '20px 0' }}>
                {uploading ? <Spin /> : <InboxOutlined style={{ fontSize: 32, color: C.primary }} />}
                <div style={{ marginTop: 8, color: C.textSecondary, fontSize: 'var(--font-size-sm)' }}>
                  点击或拖拽上传封面图
                </div>
              </div>
            </Upload.Dragger>
          )}
        </Card>

        {/* 标题 — 宽度自适应 */}
        <Card size="small" style={{ marginBottom: 16, borderRadius: 12 }}>
          <Input
            placeholder="写一个吸引人的标题..."
            value={title}
            onChange={e => setTitle(e.target.value)}
            maxLength={50}
            showCount
            style={{
              fontSize: 18, fontWeight: 600, border: 'none', outline: 'none',
              width: titleWidth || '100%', minWidth: 200, maxWidth: '100%',
            }}
            variant="borderless"
          />
        </Card>

        {/* 内容编辑区 */}
        <Card size="small" style={{ marginBottom: 16, borderRadius: 12 }}>
          <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 600, color: C.text }}>内容编辑</span>
            <Space>
              <Button icon={<FileTextOutlined />} onClick={addTextBlock}>文字段</Button>
              <Upload beforeUpload={addImageBlock} showUploadList={false}>
                <Button icon={<PictureOutlined />} loading={uploading}>插入图片</Button>
              </Upload>
              <Upload beforeUpload={addVideoBlock} showUploadList={false} accept="video/*">
                <Button icon={<VideoCameraOutlined />} loading={uploading}>插入视频</Button>
              </Upload>
            </Space>
          </div>

          {/* 内容块列表 */}
          {blocks.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '40px 0', color: C.textLight,
              border: `2px dashed ${C.border}`, borderRadius: 12,
            }}>
              <PlusOutlined style={{ fontSize: 24, marginBottom: 8 }} />
              <div>点击上方按钮添加文字段、图片或视频</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {blocks.map((block, idx) => (
                <div
                  key={idx}
                  style={{
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    overflow: 'hidden',
                    background: blocks[idx].type === 'text' ? 'var(--kb-chip-bg)' : C.cardBg,
                  }}
                >
                  {/* 块操作栏 */}
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '4px 8px', background: C.primaryLight,
                    fontSize: 12, color: C.textSecondary,
                  }}>
                    <span>{block.type === 'text' ? '文字段' : block.type === 'image' ? '图片' : '视频'} #{idx + 1}</span>
                    <Space size={2}>
                      <Button type="text" icon={<ArrowUpOutlined />} disabled={idx === 0}
                        onClick={() => moveBlock(idx, -1)} />
                      <Button type="text" icon={<ArrowDownOutlined />} disabled={idx === blocks.length - 1}
                        onClick={() => moveBlock(idx, 1)} />
                      <Button type="text" danger icon={<DeleteOutlined />}
                        onClick={() => removeBlock(idx)} />
                    </Space>
                  </div>

                  {/* 块内容 */}
                  {block.type === 'text' ? (
                    <TextArea
                      value={block.content}
                      onChange={e => updateBlock(idx, 'content', e.target.value)}
                      placeholder="输入文字内容..."
                      autoSize={{ minRows: 3 }}
                      style={{ border: 'none', resize: 'vertical', fontSize: 15, lineHeight: 1.8 }}
                      variant="borderless"
                    />
                  ) : block.type === 'image' ? (
                    <div>
                      <img src={block.url} alt="" style={{ width: '100%', maxHeight: 400, objectFit: 'cover' }} />
                      <Input
                        value={block.caption}
                        onChange={e => updateBlock(idx, 'caption', e.target.value)}
                        placeholder="图片说明（选填）..."
                        style={{ border: 'none', textAlign: 'center', fontSize: 'var(--font-size-sm)', color: C.textLight }}
                        variant="borderless"
                      />
                    </div>
                  ) : (
                    <div>
                      <video
                        src={block.url}
                        controls
                        playsInline
                        style={{ width: '100%', maxHeight: 420, borderRadius: 8, background: '#000', display: 'block' }}
                      />
                      <Input
                        value={block.caption}
                        onChange={e => updateBlock(idx, 'caption', e.target.value)}
                        placeholder="视频说明（选填）..."
                        style={{ border: 'none', textAlign: 'center', fontSize: 'var(--font-size-sm)', color: C.textLight }}
                        variant="borderless"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* 分类与标签 */}
        <Card size="small" style={{ marginBottom: 16, borderRadius: 12 }}>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={12}>
              <div style={{ marginBottom: 6, fontSize: 'var(--font-size-sm)', fontWeight: 600, color: C.text }}>分类</div>
              <Select
                value={category || undefined}
                onChange={setCategory}
                placeholder="选择分类"
                style={{ width: '100%' }}
                options={CATEGORIES.map(c => ({ value: c, label: c }))}
              />
            </Col>
            <Col xs={24} md={12}>
              <div style={{ marginBottom: 6, fontSize: 'var(--font-size-sm)', fontWeight: 600, color: C.text }}>难度</div>
              <Select
                value={difficulty}
                onChange={setDifficulty}
                style={{ width: '100%' }}
                options={DIFFICULTIES.map(d => ({ value: d, label: d }))}
              />
            </Col>
          </Row>

          <Divider style={{ margin: '12px 0' }} />

          {/* 商品标签 */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ marginBottom: 6, fontSize: 'var(--font-size-sm)', fontWeight: 600, color: C.text }}>商品分类标签</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
              {productTags.map(t => (
                <Tag key={t} closable onClose={() => setProductTags(prev => prev.filter(x => x !== t))}
                  style={{ borderRadius: 10, background: C.tagBg, color: C.tagText, border: 'none' }}>
                  {t}
                </Tag>
              ))}
            </div>
            <Input
              placeholder="输入标签后回车"
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onPressEnter={addProductTag}
              size="small"
              style={{ width: 200 }}
              prefix={<PlusOutlined style={{ color: C.textLight }} />}
            />
          </div>

          {/* 卖点标签 */}
          <div>
            <div style={{ marginBottom: 6, fontSize: 'var(--font-size-sm)', fontWeight: 600, color: C.text }}>卖点标签</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
              {sellingTags.map(t => (
                <Tag key={t} closable onClose={() => setSellingTags(prev => prev.filter(x => x !== t))}
                  style={{ borderRadius: 10, background: 'var(--kb-orange-bg)', color: 'var(--kb-orange-text)', border: 'none' }}>
                  {t}
                </Tag>
              ))}
            </div>
            <Input
              placeholder="输入卖点后回车"
              value={sellingTagInput}
              onChange={e => setSellingTagInput(e.target.value)}
              onPressEnter={addSellingTag}
              size="small"
              style={{ width: 200 }}
              prefix={<PlusOutlined style={{ color: C.textLight }} />}
            />
          </div>
        </Card>

        {/* 定时发布 */}
        <Card size="small" style={{ borderRadius: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: C.text }}>
                <ClockCircleOutlined style={{ marginRight: 6 }} />定时发布
              </div>
              <div style={{ fontSize: 12, color: C.textLight }}>设定时间后自动发布</div>
            </div>
            <Switch checked={scheduleEnabled} onChange={setScheduleEnabled} />
          </div>
          {scheduleEnabled && (
            <div style={{ marginTop: 12 }}>
              <DatePicker
                showTime
                value={scheduleTime}
                onChange={setScheduleTime}
                format="YYYY-MM-DD HH:mm"
                style={{ width: '100%' }}
                placeholder="选择发布时间"
              />
              <div style={{ marginTop: 8, fontSize: 12, color: C.textLight }}>
                注意：定时发布会以草稿状态保存，到时间后需手动点击发布
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* 底部操作栏 */}
      <div style={{
        position: 'fixed', bottom: isMobile ? 52 : 0, left: 0, right: 0, zIndex: 100,
        background: 'var(--kb-header-bg)', backdropFilter: 'blur(12px)',
        borderTop: `1px solid ${C.border}`,
        padding: '10px 16px',
        display: 'flex', justifyContent: 'center', gap: 12,
      }}>
        <Button onClick={() => navigate('/knowledge/admin')} icon={<ArrowLeftOutlined />}>取消</Button>
        <Button icon={<SaveOutlined />} loading={saving} onClick={() => handleSave('draft')}>存草稿</Button>
        <Button type="primary" icon={<CloudUploadOutlined />} loading={saving}
          onClick={() => handleSave('published')}
          style={{ background: C.primary, borderColor: C.primary }}>
          {isEdit ? '保存并发布' : '发布笔记'}
        </Button>
      </div>
    </div>
  );
}
