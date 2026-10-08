import { TABLE_SCROLL_X } from '../components/tableConstants';
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Table, Button, Input, Tag, Space, Modal, Popconfirm, Select, message,
  Card, Pagination, Image, Tooltip, Grid, Spin,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, PushpinOutlined, PushpinFilled,
  SearchOutlined, EyeOutlined, HeartOutlined,
} from '@ant-design/icons';
import FilterBar from '../components/FilterBar';
import EmptyState from '../components/EmptyState';
import api from '../api';

const { useBreakpoint } = Grid;

const CATEGORIES = ['商品品类', '产品系列', '销售话术', '售后知识点'];
const STATUSES = [
  { value: 'draft', label: '草稿', color: 'default' },
  { value: 'published', label: '已发布', color: 'success' },
  { value: 'archived', label: '已下架', color: 'warning' },
];

const DIFFICULTY_MAP = {
  '入门': { color: 'var(--kb-diff-begin-text)', bg: 'var(--kb-diff-begin-bg)' },
  '进阶': { color: 'var(--kb-diff-mid-text)', bg: 'var(--kb-diff-mid-bg)' },
  '高级': { color: 'var(--kb-diff-adv-text)', bg: 'var(--kb-diff-adv-bg)' },
};

// 统一令牌（与 Feed / Detail / Editor 一致的语雀/Notion 风）
const C = {
  primary: 'var(--color-primary)',
  primaryLight: 'var(--kb-primary-light)',
  cardBg: 'var(--color-bg-white)',
  text: 'var(--kb-text)',
  borderLight: 'var(--color-border-light)',
};

export default function KnowledgeAdmin() {
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const [loading, setLoading] = useState(true);
  const [list, setList] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchAction, setBatchAction] = useState('category');
  const [batchValue, setBatchValue] = useState('');

  const loadList = (pageNum = 1) => {
    setLoading(true);
    const params = { page: pageNum, page_size: pageSize };
    if (search) params.search = search;
    if (category) params.category = category;
    if (status) params.status = status;
    api.get('/knowledge/admin', { params })
      .then(({ data }) => {
        setList(data.list);
        setTotal(data.total);
      })
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadList(1); }, []);

  const handleSearch = () => { setPage(1); loadList(1); };
  const clearFilters = () => { setSearch(''); setCategory(''); setStatus(''); setPage(1); };

  const hasFilters = search || category || status;

  const stats = useMemo(() => ({
    total,
    published: list.filter(n => n.status === 'published').length,
    draft: list.filter(n => n.status === 'draft').length,
    archived: list.filter(n => n.status === 'archived').length,
  }), [list, total]);

  const handleDelete = (id) => {
    api.delete(`/knowledge/admin/${id}`).then(() => {
      message.success('删除成功');
      loadList(page);
    }).catch(() => message.error('删除失败'));
  };

  const handlePin = (id) => {
    api.put(`/knowledge/admin/${id}/pin`).then(() => loadList(page)).catch(() => message.error('操作失败'));
  };

  const handleStatusChange = (id, newStatus) => {
    api.put(`/knowledge/admin/${id}`, { status: newStatus }).then(() => {
      message.success(newStatus === 'published' ? '已发布' : newStatus === 'archived' ? '已下架' : '已保存为草稿');
      loadList(page);
    }).catch(() => message.error('操作失败'));
  };

  const handleBatch = () => {
    if (batchAction === 'delete') {
      Modal.confirm({
        title: '确认批量删除',
        content: `将删除 ${selectedRowKeys.length} 篇笔记，不可恢复`,
        okText: '确认删除', okType: 'danger', cancelText: '取消',
        onOk: () => doBatch(),
      });
    } else { doBatch(); }
  };

  const doBatch = () => {
    api.put('/knowledge/admin/batch', {
      ids: selectedRowKeys, action: batchAction, value: batchValue,
    }).then(({ data }) => {
      message.success(data.message);
      setSelectedRowKeys([]);
      setBatchModalOpen(false);
      loadList(page);
    }).catch(() => message.error('操作失败'));
  };

  const columns = [
    {
      title: '封面', dataIndex: 'cover_image', key: 'cover', width: 80, align: 'center',
      render: (v) => v
        ? <Image src={v} width={52} height={69} style={{ objectFit: 'cover', borderRadius: 6 }} preview={{ mask: null }} />
        : <div style={{ width: 56, height: 69, borderRadius: 6, background: 'var(--kb-cover-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}>
            <span style={{ color: 'var(--color-primary)', fontSize: 20, opacity: 0.3 }}>📄</span>
          </div>,
    },
    {
      title: '标题', dataIndex: 'title', key: 'title', width: 224, ellipsis: true,
      render: (v, r) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {r.is_pinned && <PushpinFilled style={{ color: 'var(--color-primary)', fontSize: 12, flexShrink: 0 }} />}
          <span style={{ fontWeight: 500 }}>{v}</span>
        </div>
      ),
    },
    {
      title: '分类', dataIndex: 'category', key: 'category', width: 104, align: 'left',
      render: (v) => v ? (
        <Tag style={{ margin: 0, borderRadius: 4, padding: '0 8px', lineHeight: '22px', background: 'var(--color-primary-light)', color: 'var(--color-primary)', border: 'none', fontWeight: 500 }}>{v}</Tag>
      ) : <span style={{ color: 'var(--color-text-tertiary)' }}>-</span>,
    },
    {
      title: '难度', dataIndex: 'difficulty', key: 'difficulty', width: 72, align: 'center',
      render: (v) => {
        const d = DIFFICULTY_MAP[v];
        return d ? (
          <Tag style={{ margin: 0, borderRadius: 4, padding: '0 8px', lineHeight: '22px', background: d.bg, color: d.color, border: 'none', fontWeight: 500 }}>{v}</Tag>
        ) : <span style={{ color: 'var(--color-text-tertiary)' }}>-</span>;
      },
    },
    {
      title: '标签', dataIndex: 'product_tags', key: 'tags', width: 160,
      render: (_, r) => {
        const allTags = [
          ...(r.product_tags || []).map(t => ({ text: t, type: 'product' })),
          ...(r.selling_tags || []).map(t => ({ text: t, type: 'selling' })),
        ];
        if (!allTags.length) return <span style={{ color: 'var(--color-text-tertiary)' }}>-</span>;
        return (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {allTags.slice(0, 3).map(t => (
              <span key={t.text} style={{
                fontSize: 11, padding: '0 6px', borderRadius: 3, lineHeight: '18px',
                background: t.type === 'selling' ? 'var(--kb-sell-bg)' : 'var(--kb-prod-bg)',
                color: t.type === 'selling' ? 'var(--kb-sell-text)' : 'var(--color-text-tertiary)',
              }}>{t.text}</span>
            ))}
            {allTags.length > 3 && (
              <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', lineHeight: '18px' }}>+{allTags.length - 3}</span>
            )}
          </div>
        );
      },
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 112, align: 'center',
      render: (v, r) => (
        <Select value={v}
          onChange={(val) => handleStatusChange(r.id, val)}
          style={{ width: 88 }}
          options={STATUSES.map(s => ({ value: s.value, label: s.label }))} />
      ),
    },
    {
      title: '浏览', dataIndex: 'view_count', key: 'view', width: 72, align: 'center',
      render: (v, r) => (
        <Tooltip title={`浏览 ${v || 0} · 收藏 ${r.favorite_count || 0}`}>
          <span style={{ color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>
            <EyeOutlined style={{ marginRight: 3, fontSize: 12 }} />{v || 0}
          </span>
        </Tooltip>
      ),
    },
    {
      title: '创建时间', dataIndex: 'created_at', key: 'created', width: 104, align: 'center',
      render: (v) => <span style={{ color: 'var(--color-text-tertiary)' }}>{v?.slice(0, 10)}</span>,
    },
    {
      title: '排序', dataIndex: 'sort_order', key: 'sort', width: 64, align: 'center',
      render: (v) => v || <span style={{ color: 'var(--color-text-tertiary)' }}>-</span>,
    },
    {
      title: '操作', key: 'action', width: 152, align: 'center', fixed: 'right',
      render: (_, r) => (
        <Space size={4}>
          <Tooltip title="预览">
            <Button icon={<EyeOutlined />}
              className="app-action-btn"
              onClick={() => navigate(`/knowledge/detail/${r.id}`)} />
          </Tooltip>
          <Tooltip title="编辑">
            <Button icon={<EditOutlined />}
              className="app-action-btn"
              onClick={() => navigate(`/knowledge/editor/${r.id}`)} />
          </Tooltip>
          <Tooltip title={r.is_pinned ? '取消置顶' : '置顶'}>
            <Button
              icon={r.is_pinned ? <PushpinFilled /> : <PushpinOutlined />}
              className="app-action-btn"
              style={r.is_pinned ? { borderColor: 'var(--color-primary)', color: 'var(--color-primary)', background: 'var(--color-primary-light)' } : {}}
              onClick={() => handlePin(r.id)} />
          </Tooltip>
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(r.id)}
            okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
            <Tooltip title="删除">
              <Button icon={<DeleteOutlined />}
                className="app-action-btn app-action-del" />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const renderDesktop = () => (
    <div>
      {/* ===== 统计卡片 ===== */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        <Card size="small" style={{ flex: 1, borderRadius: 8 }}
          styles={{ body: { padding: '16px 20px' } }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginBottom: 4 }}>全部笔记</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-primary)' }}>{stats.total}</div>
        </Card>
        <Card size="small" style={{ flex: 1, borderRadius: 8 }}
          styles={{ body: { padding: '16px 20px' } }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginBottom: 4 }}>已发布</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--kb-diff-begin-text)' }}>{stats.published}</div>
        </Card>
        <Card size="small" style={{ flex: 1, borderRadius: 8 }}
          styles={{ body: { padding: '16px 20px' } }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginBottom: 4 }}>草稿</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-text-secondary)' }}>{stats.draft}</div>
        </Card>
        <Card size="small" style={{ flex: 1, borderRadius: 8 }}
          styles={{ body: { padding: '16px 20px' } }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginBottom: 4 }}>已下架</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--kb-diff-mid-text)' }}>{stats.archived}</div>
        </Card>
      </div>

      {/* ===== 筛选栏 ===== */}
      <Card size="small" style={{ marginBottom: 12, borderRadius: 8 }}
        styles={{ body: { padding: '16px 20px' } }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <FilterBar style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Input
              placeholder="搜索标题..."
              prefix={<SearchOutlined />}
              value={search}
              onChange={e => setSearch(e.target.value)}
              onPressEnter={handleSearch}
              allowClear
              className="w-md"
            />
            <Select
              placeholder="全部分类"
              value={category || undefined}
              onChange={v => setCategory(v || '')}
              allowClear
              className="w-sm"
              options={CATEGORIES.map(c => ({ value: c, label: c }))} />
            <Select
              placeholder="全部状态"
              value={status || undefined}
              onChange={v => setStatus(v || '')}
              allowClear
              className="w-sm"
              options={STATUSES.map(s => ({ value: s.value, label: s.label }))} />
            <Button onClick={handleSearch} icon={<SearchOutlined />}>
              搜索
            </Button>
            {hasFilters && (
              <Button onClick={clearFilters} type="text"
                style={{ color: 'var(--color-text-tertiary)' }}>
                清除筛选
              </Button>
            )}
          </FilterBar>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/knowledge/editor')}>
            新建笔记
          </Button>
        </div>

        {/* 批量操作栏 */}
        {selectedRowKeys.length > 0 && (
          <div style={{
            marginTop: 12, paddingTop: 12,
            borderTop: '1px solid var(--color-border-light)',
            display: 'flex', gap: 8, alignItems: 'center',
          }}>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>
              已选 {selectedRowKeys.length} 项
            </span>
            <Button style={{ borderRadius: 6, height: 32 }}
              onClick={() => { setBatchAction('category'); setBatchValue(''); setBatchModalOpen(true); }}>
              批量分类
            </Button>
            <Button style={{ borderRadius: 6, height: 32 }}
              onClick={() => { setBatchAction('status'); setBatchValue('published'); setBatchModalOpen(true); }}>
              批量发布
            </Button>
            <Button danger style={{ borderRadius: 6, height: 32 }}
              onClick={() => { setBatchAction('delete'); setBatchValue(''); handleBatch(); }}>
              批量删除
            </Button>
            <Button type="link" onClick={() => setSelectedRowKeys([])}>
              取消选择
            </Button>
          </div>
        )}
      </Card>

      {/* ===== 表格 ===== */}
      <Card size="small" style={{ borderRadius: 8, marginBottom: 0 }}
        styles={{ body: { padding: 0 } }}>
        <div className="app-data-table">
          <Table
            rowKey="id"
            dataSource={list}
            columns={columns}
            loading={loading}
            rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
            scroll={{ x: TABLE_SCROLL_X.standard }}
            size="middle"
            rowClassName={(_, idx) => idx % 2 === 0 ? 'app-row-even' : 'app-row-odd'}
            pagination={false}
          />
        </div>
      </Card>

      {/* ===== 分页栏 ===== */}
      {total > 0 && (
        <div className="app-pagination-bar">
          <span className="app-pagination-total">共 {total} 篇</span>
          <Pagination
            current={page}
            total={total}
            pageSize={pageSize}
            onChange={(p) => { setPage(p); loadList(p); }}
            showSizeChanger={false}
            size="small"
          />
        </div>
      )}

      {/* 批量操作弹窗 */}
      <Modal
        className="modal-md"
        title={batchAction === 'category' ? '批量设置分类' : '批量修改状态'}
        open={batchModalOpen}
        onCancel={() => setBatchModalOpen(false)}
        onOk={handleBatch}
        okText="确认" cancelText="取消"
      >
        <div style={{ padding: '16px 0' }}>
          <p style={{ marginBottom: 12, color: 'var(--color-text-tertiary)' }}>
            将对 <b style={{ color: 'var(--color-text)' }}>{selectedRowKeys.length}</b> 篇笔记执行操作
          </p>
          {batchAction === 'category' && (
            <Select placeholder="选择分类" value={batchValue || undefined}
              onChange={setBatchValue} style={{ width: '100%' }}
              options={CATEGORIES.map(c => ({ value: c, label: c }))} />
          )}
          {batchAction === 'status' && (
            <Select placeholder="选择状态" value={batchValue || undefined}
              onChange={setBatchValue} style={{ width: '100%' }}
              options={STATUSES.map(s => ({ value: s.value, label: s.label }))} />
          )}
        </div>
      </Modal>
    </div>
  );

  // ===== 手机端：卡片列表（桌面端 renderDesktop 逐字保留） =====
  const renderMobile = () => {
    const statsCards = [
      { label: '全部笔记', value: stats.total, color: 'var(--color-primary)' },
      { label: '已发布', value: stats.published, color: 'var(--kb-diff-begin-text)' },
      { label: '草稿', value: stats.draft, color: 'var(--kb-text-secondary)' },
      { label: '已下架', value: stats.archived, color: 'var(--kb-diff-mid-text)' },
    ];
    return (
      <div style={{ minHeight: '100vh', background: 'var(--color-bg)', paddingBottom: 80 }}>
        {/* 统计 2x2 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: 12 }}>
          {statsCards.map(s => (
            <div key={s.label} style={{
              background: C.cardBg, borderRadius: 12, padding: '16px',
              boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
            }}>
              <div style={{ fontSize: 12, color: 'var(--kb-text-muted)', marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* 筛选 */}
        <div style={{ padding: '0 12px 12px' }}>
          <div style={{ background: C.cardBg, borderRadius: 12, padding: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
            <Input
              placeholder="搜索标题..."
              prefix={<SearchOutlined />}
              value={search}
              onChange={e => setSearch(e.target.value)}
              onPressEnter={handleSearch}
              allowClear
              style={{ width: '100%', height: 42, borderRadius: 10, marginBottom: 8 }}
            />
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <Select
                placeholder="全部分类"
                value={category || undefined}
                onChange={v => setCategory(v || '')}
                allowClear
                style={{ flex: 1, height: 40, borderRadius: 10 }}
                options={CATEGORIES.map(c => ({ value: c, label: c }))}
              />
              <Select
                placeholder="全部状态"
                value={status || undefined}
                onChange={v => setStatus(v || '')}
                allowClear
                style={{ flex: 1, height: 40, borderRadius: 10 }}
                options={STATUSES.map(s => ({ value: s.value, label: s.label }))}
              />
              <Button onClick={handleSearch} icon={<SearchOutlined />}
                style={{ width: 40, height: 40, borderRadius: 10, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }} />
              {hasFilters && (
                <Button onClick={clearFilters} type="text"
                  style={{ color: 'var(--kb-text-muted)', height: 40, padding: '0 6px', flexShrink: 0 }}>清除</Button>
              )}
            </div>
          </div>
        </div>

        {/* 列表 */}
        <div style={{ padding: '0 12px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '60px 0' }}><Spin /></div>
          ) : list.length === 0 ? (
            <EmptyState title="暂无笔记" description="前往知识库添加第一篇笔记" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {list.map(n => (
                <div key={n.id} style={{
                  background: C.cardBg, borderRadius: 12, overflow: 'hidden',
                  border: '1px solid var(--color-border-light)', boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                }}>
                  <div style={{ display: 'flex', gap: 12, padding: 12 }}>
                    {n.cover_image ? (
                      <img src={n.cover_image} alt="" style={{ width: 56, height: 72, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 56, height: 72, borderRadius: 8, flexShrink: 0, background: 'var(--kb-cover-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: 'var(--color-primary)', opacity: 0.4 }}>📄</div>
                    )}
                    <div style={{ flex: 1, minWidth: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {n.is_pinned && <PushpinFilled style={{ color: 'var(--color-primary)', fontSize: 12, flexShrink: 0 }} />}
                        <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--kb-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 8 }}>
                        {n.category && (
                          <span style={{ fontSize: 10, lineHeight: '18px', padding: '0 7px', borderRadius: 4, background: 'var(--kb-cover-bg)', color: 'var(--color-primary)' }}>{n.category}</span>
                        )}
                        {n.difficulty && (
                          <span style={{ fontSize: 10, lineHeight: '18px', padding: '0 7px', borderRadius: 4, background: DIFFICULTY_MAP[n.difficulty]?.bg, color: DIFFICULTY_MAP[n.difficulty]?.color }}>{n.difficulty}</span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--kb-text-muted)', marginTop: 8, display: 'flex', gap: 12 }}>
                        <span><EyeOutlined style={{ marginRight: 3 }} />{n.view_count || 0}</span>
                        <span><HeartOutlined style={{ marginRight: 3 }} />{n.favorite_count || 0}</span>
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', height: 32 }}>
                      <Select value={n.status}
                        onChange={(val) => handleStatusChange(n.id, val)}
                        style={{ width: 96 }}
                        options={STATUSES.map(s => ({ value: s.value, label: s.label }))}
                      />
                    </div>
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, height: 32 }}>
                      <Button icon={<EyeOutlined />} onClick={() => navigate(`/knowledge/detail/${n.id}`)} />
                      <Button icon={<EditOutlined />} onClick={() => navigate(`/knowledge/editor/${n.id}`)} />
                      <Button
                        icon={n.is_pinned ? <PushpinFilled /> : <PushpinOutlined />}
                        style={n.is_pinned ? { borderColor: 'var(--color-primary)', color: 'var(--color-primary)', background: 'var(--color-primary-light)' } : {}}
                        onClick={() => handlePin(n.id)} />
                      <Popconfirm title="确认删除？" onConfirm={() => handleDelete(n.id)}
                        okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
                        <Button danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 分页 + 新建 */}
        <div style={{
          position: 'fixed', bottom: isMobile ? 52 : 0, left: 0, right: 0, zIndex: 100,
          background: 'var(--kb-header-bg)', backdropFilter: 'blur(12px)',
          borderTop: '1px solid var(--color-border-light)', padding: '8px 16px',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/knowledge/editor')}
            style={{ flex: 1, height: 42, borderRadius: 10, background: 'var(--color-primary)', borderColor: 'var(--color-primary)' }}>
            新建笔记
          </Button>
          {total > 0 && (
            <Pagination
              current={page}
              total={total}
              pageSize={pageSize}
              onChange={(p) => { setPage(p); loadList(p); }}
              showSizeChanger={false}
              size="small"
            />
          )}
        </div>
      </div>
    );
  };

  return isMobile ? renderMobile() : renderDesktop();
}
