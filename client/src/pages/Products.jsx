import { TABLE_SCROLL_X } from '../components/tableConstants';
import { useState, useEffect, useMemo } from 'react';
import dayjs from 'dayjs';
import { Card, Table, Button, Modal, Form, Input, InputNumber, Select, Space, Tag, message, Popconfirm, Upload, Image, Tooltip, Pagination, Grid, AutoComplete, Switch, Row, Col } from 'antd';
import { PlusOutlined, DeleteOutlined, UploadOutlined, EditOutlined, SearchOutlined, MinusCircleOutlined, AppstoreOutlined, CopyOutlined } from '@ant-design/icons';
import api from '../api';
import PageHeader from '../components/PageHeader';
import ExcelImportExport from '../components/ExcelImportExport';
import FilterBar from '../components/FilterBar';
import EmptyState from '../components/EmptyState';

const categoryMap = {
  sample: { color: 'blue', text: '样品' },
  gift: { color: 'green', text: '赠品' },
  order: { color: 'orange', text: '订货' },
};

// 品牌、规格均不预设行业专属值，系统服务于任意行业（品牌改为自由输入）

export default function Products() {
  const { md } = Grid.useBreakpoint();
  const isMobile = !md;
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form] = Form.useForm();
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState(null);
  const [typeFilter, setTypeFilter] = useState(null);
  const [activeFilter, setActiveFilter] = useState(null);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // 变体状态
  const [variants, setVariants] = useState([]);
  // 门店目标利润率（用于实时计算保本价预览）
  const [margin, setMargin] = useState(0.4);
  useEffect(() => {
    (async () => {
      try {
        const r = await api.get('/config');
        const m = Number(r.data?.break_even_margin);
        if (m > 0 && m < 1) setMargin(m);
      } catch {}
    })();
  }, []);

  // 库存数量自动汇总为所有规格库存之和
  useEffect(() => {
    const total = variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);
    form.setFieldValue('stock', total);
  }, [variants, form]);

  const groupedProducts = useMemo(() => {
    const groups = {};
    products.forEach(p => {
      // 按 名称+分类 组合分组，避免不同类目下同名商品被错误合并隐藏
      const key = p.name + '|' + (p.category || '');
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    });
    return Object.entries(groups).map(([key, items]) => ({
      ...items[0],
      _name: items[0].name,
      _groupItems: items,
      _count: items.length,
    }));
  }, [products]);

  // 类目选项：从已加载商品去重派生，供表单自动补全与筛选下拉使用
  const typeOptions = useMemo(() => {
    const set = new Set();
    products.forEach(p => { if (p.type) set.add(p.type); });
    return Array.from(set).map(t => ({ value: t, label: t }));
  }, [products]);

  const filtered = useMemo(() => {
    let list = groupedProducts;
    if (search) {
      const kw = search.toLowerCase();
      list = list.filter(p =>
        (p.name || '').toLowerCase().includes(kw) ||
        (p.code || '').toLowerCase().includes(kw) ||
        (p.barcode || '').toLowerCase().includes(kw) ||
        (p.brand || '').toLowerCase().includes(kw) ||
        (p.type || '').toLowerCase().includes(kw)
      );
    }
    if (catFilter) { list = list.filter(p => p.category === catFilter); }
    if (typeFilter) { list = list.filter(p => (p.type || '') === typeFilter); }
    if (activeFilter !== null) { list = list.filter(p => activeFilter ? p.active : !p.active); }
    return list;
  }, [groupedProducts, search, catFilter, typeFilter, activeFilter]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page]);

  useEffect(() => { setPage(1); }, [search, catFilter, typeFilter, activeFilter]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/products');
      setProducts(res.data);
    } catch {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ images: [], category: 'order', unit: '件', sort_order: 0, stock: 0, active: true });
    setVariants([{ spec: '', price: undefined, cost_price: undefined, stock: 0 }]);
    setModalOpen(true);
  };

  const openEdit = async (record) => {
    setEditing(record);
    try {
      // 拉取详情（含 price_breakdown 与变体），统一价格口径预览
      const det = await api.get(`/products/${record.id}`);
      const p = det.data;
      const imgs = Array.isArray(p.images) ? p.images : (() => { try { return JSON.parse(p.images || '[]'); } catch { return []; } })();
      form.setFieldsValue({
        ...p,
        images: imgs,
        promo_start: p.promo_start ? dayjs(p.promo_start) : null,
        promo_end: p.promo_end ? dayjs(p.promo_end) : null,
      });
      const vs = (p.variants && p.variants.length)
        ? p.variants
        : [{ spec: p.spec || '', price: p.price, cost_price: p.cost_price, stock: p.stock }];
      setVariants(vs.map(v => ({ id: v.id, spec: v.spec, price: v.price, cost_price: v.cost_price, stock: v.stock })));
      setModalOpen(true);
    } catch {
      message.error('加载商品详情失败');
    }
  };

  const handleUpload = async ({ fileList: newFiles }) => {
    const pending = newFiles.filter(f => f.status === 'uploading' || !f.status);
    if (pending.length === 0) return;

    setUploading(true);
    try {
      const currentImages = form.getFieldValue('images') || [];
      const formData = new FormData();
      for (const f of pending) {
        if (f.originFileObj) formData.append('images', f.originFileObj);
      }
      const res = await api.post('/upload/images?target=product', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      const newImages = [...currentImages, ...res.data.urls];
      form.setFieldValue('images', newImages);
      message.success(`上传成功，共 ${newImages.length} 张图片`);
    } catch (err) {
      message.error('上传失败: ' + (err.response?.data?.error || err.message));
    } finally {
      setUploading(false);
    }
  };

  const removeImage = (idx) => {
    const currentImages = form.getFieldValue('images') || [];
    const newImages = currentImages.filter((_, i) => i !== idx);
    form.setFieldValue('images', newImages);
  };

  // 变体操作
  const addVariant = () => {
    setVariants([...variants, { spec: '', price: undefined, cost_price: undefined, stock: 0 }]);
  };

  const copyLastVariant = () => {
    if (variants.length === 0) return;
    const last = variants[variants.length - 1];
    setVariants([...variants, { spec: '', price: last.price, cost_price: last.cost_price, stock: last.stock || 0 }]);
  };

  const removeVariant = (index) => {
    if (variants.length <= 1) { message.warning('至少保留一个规格'); return; }
    setVariants(variants.filter((_, i) => i !== index));
  };

  const updateVariant = (index, field, value) => {
    const updated = [...variants];
    updated[index] = { ...updated[index], [field]: value };
    setVariants(updated);
  };

  const handleSubmit = async (keepOpen = false) => {
    try {
      const values = await form.validateFields();
      // 优惠期日期转字符串（空值置空）
      const fmtDate = (v) => (v && typeof v.format === 'function' ? v.format('YYYY-MM-DD') : (v || ''));
      values.promo_start = fmtDate(values.promo_start);
      values.promo_end = fmtDate(values.promo_end);

      // 价格统一由规格首行决定（无独立价格信息卡片）
      const firstVariant = variants[0] || {};
      if (firstVariant.price == null || firstVariant.price === '') {
        message.error('请输入零售价');
        return;
      }
      values.price = firstVariant.price;
      values.cost_price = firstVariant.cost_price ?? 0;
      setSubmitting(true);

      // 过滤掉空规格的变体
      const validVariants = variants.filter(v => v.spec && v.spec.trim() !== '');

      if (editing) {
        await api.put(`/products/${editing.id}`, values);
        // 保存变体
        if (validVariants.length > 0) {
          await api.post(`/products/${editing.id}/variants`, { variants: validVariants });
        }
        message.success('更新成功');
      } else {
        const res = await api.post('/products', values);
        // 保存变体
        if (validVariants.length > 0) {
          await api.post(`/products/${res.data.id}/variants`, { variants: validVariants });
        }
        message.success('添加成功');
      }
      if (keepOpen) {
        // 连续建档：重置为新建态，弹窗不关闭
        setEditing(null);
        form.resetFields();
        form.setFieldsValue({ images: [], category: 'order', unit: '件', sort_order: 0, stock: 0, active: true });
        setVariants([{ spec: '', price: undefined, cost_price: undefined, stock: 0 }]);
      } else {
        setModalOpen(false);
      }
      load();
    } catch (err) {
      const msg = err.response?.data?.error || err.message || '操作失败';
      if (err.response) message.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (record) => {
    try {
      await api.delete(`/products/${record.id}`);
      message.success('删除成功');
      load();
    } catch (err) {
      message.error(err.response?.data?.error || '删除失败');
    };
  };

  const columns = [
    {
      title: '图片', dataIndex: 'images', key: 'images', width: 72, align: 'center',
      render: (v, r) => {
        const imgs = Array.isArray(v) ? v : (() => { try { return JSON.parse(v || '[]'); } catch { return []; } })();
        return imgs.length > 0
          ? <Image src={imgs[0]} width={44} height={44} style={{ objectFit: 'cover', borderRadius: 6 }} />
          : <div style={{ width: 48, height: 44, background: 'var(--color-bg-white)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-tertiary)', fontSize: 11 }}>无图</div>;
      }
    },
    { title: '名称', dataIndex: 'name', key: 'name', width: 144, align: 'left',
      render: (v, r) => r._count > 1 ? (
        <Space size={4}>
          <span style={{ fontWeight: 500 }}>{v}</span>
          <Tag color="purple">{r._count}款</Tag>
        </Space>
      ) : <span style={{ fontWeight: 500 }}>{v}</span>
    },
    { title: '品牌', dataIndex: 'brand', key: 'brand', width: 72, align: 'left',
      render: v => v || <span style={{ color: 'var(--color-text-tertiary)' }}>-</span> },
    { title: '型号', dataIndex: 'model', key: 'model', width: 80, align: 'left',
      render: v => v || <span style={{ color: 'var(--color-text-tertiary)' }}>-</span> },
    { title: '编码', dataIndex: 'code', key: 'code', width: 104, align: 'left',
      render: v => v || <span style={{ color: 'var(--color-text-tertiary)' }}>-</span> },
    { title: '条码', dataIndex: 'barcode', key: 'barcode', width: 120, align: 'left',
      render: v => v || <span style={{ color: 'var(--color-text-tertiary)' }}>-</span> },
    { title: '规格', dataIndex: 'spec', key: 'spec', width: 80, align: 'left',
      render: (v, r) => {
        if (r.variants && r.variants.length > 0) {
          return <span>{r.variants.map(vt => vt.spec).join(' / ')}</span>;
        }
        return v || <span style={{ color: 'var(--color-text-tertiary)' }}>-</span>;
      }
    },
    { title: '分类', dataIndex: 'category', key: 'category', width: 72, align: 'center',
      render: c => <Tag color={categoryMap[c]?.color}>{categoryMap[c]?.text}</Tag>
    },
    { title: '类目', dataIndex: 'type', key: 'type', width: 88, align: 'left',
      render: v => v || <span style={{ color: 'var(--color-text-tertiary)' }}>-</span> },
    { title: '保本价', dataIndex: 'break_even_price', key: 'break_even_price', width: 96, align: 'right',
      render: (v, r) => {
        if (r.variants && r.variants.length > 0) {
          const bes = r.variants.map(vt => Number(vt.break_even_price) || 0).filter(Boolean);
          if (bes.length > 1) return <span style={{ color: 'var(--color-text-tertiary)' }}>¥{bes[0].toLocaleString()}~¥{bes[bes.length-1].toLocaleString()}</span>;
          if (bes.length === 1) return <span style={{ fontVariantNumeric: 'tabular-nums' }}>¥{Number(bes[0]).toLocaleString()}</span>;
        }
        return v ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>¥{Number(v).toLocaleString()}</span> : <span style={{ color: 'var(--color-text-tertiary)' }}>-</span>;
      }
    },
    { title: '售价', dataIndex: 'price', key: 'price', width: 80, align: 'right',
      render: v => <span style={{ fontVariantNumeric: 'tabular-nums' }}>¥{Number(v||0).toLocaleString()}</span>
    },
    { title: '库存', dataIndex: 'stock', key: 'stock', width: 64, align: 'center',
      render: v => {
        const n = v || 0;
        if (n === 0) return <Tag color="red">0</Tag>;
        if (n <= 5) return <Tag color="orange">{n}</Tag>;
        return <Tag color="green">{n}</Tag>;
      }
    },
    { title: '在途', dataIndex: 'in_transit', key: 'in_transit', width: 64, align: 'center',
      render: v => {
        const n = v || 0;
        if (n === 0) return <span style={{ color: 'var(--color-text-tertiary)' }}>--</span>;
        return <Tag color="blue">{n}</Tag>;
      }
    },
    { title: '亮点', dataIndex: 'highlight', key: 'highlight', width: 128, ellipsis: { showTitle: false }, align: 'left',
      render: v => v ? (
        <Tooltip title={v}><span style={{ display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span></Tooltip>
      ) : <span style={{ color: 'var(--color-text-tertiary)' }}>-</span>
    },
    { title: '状态', dataIndex: 'active', key: 'active', width: 64, align: 'center',
      render: v => <Tag color={v ? 'green' : 'red'}>{v ? '上架' : '下架'}</Tag>
    },
    { title: '操作', key: 'action', width: 120, align: 'center', fixed: 'right',
      render: (_, r) => (
        <Space size={4} className="products-actions-cell">
          <Button icon={<EditOutlined />}
            className="app-action-btn"
            onClick={() => openEdit(r)}
            title="编辑" />
          <Popconfirm title="确定删除该商品？" onConfirm={() => handleDelete(r)} okText="确定" cancelText="取消">
            <Button icon={<DeleteOutlined />}
              className="app-action-btn app-action-del"
              title="删除" />
          </Popconfirm>
        </Space>
      )
    },
  ];

  return (
    <div>
      <PageHeader title="商品管理" />
      {/* ===== 筛选与操作栏 ===== */}
      <FilterBar>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Input
              placeholder="搜索名称/编码/条码/品牌"
              prefix={<SearchOutlined />}
              value={search}
              onChange={e => setSearch(e.target.value)}
              allowClear
              className="filter-search"
            />
            <Select
              placeholder="分类筛选"
              value={catFilter}
              onChange={v => setCatFilter(v || null)}
              allowClear
              className="w-sm"
            >
              <Select.Option value="sample">样品</Select.Option>
              <Select.Option value="gift">赠品</Select.Option>
              <Select.Option value="order">订货</Select.Option>
            </Select>
            <Select
              placeholder="状态筛选"
              value={activeFilter}
              onChange={v => setActiveFilter(v ?? null)}
              allowClear
              className="w-sm"
            >
              <Select.Option value={1}>上架</Select.Option>
              <Select.Option value={0}>下架</Select.Option>
            </Select>
            <Select
              placeholder="类目筛选"
              value={typeFilter}
              onChange={v => setTypeFilter(v || null)}
              allowClear
              className="w-sm"
            >
              {typeOptions.map(t => <Select.Option key={t.value} value={t.value}>{t.label}</Select.Option>)}
            </Select>
            <ExcelImportExport module="products" onImported={load} />
          </div>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}
            className="products-create-btn-pc"
            style={{ borderRadius: 8, height: 36, fontWeight: 600 }}>
            添加商品
          </Button>
        </div>
      </FilterBar>

      {/* ===== 数据区 ===== */}
      {isMobile ? (
        <div className="x-mcard-list">
          {paginated.map(r => (
            <div className="x-mcard" key={r._name || r.id}>
              <div className="x-mcard-head">
                <div className="x-mcard-title">
                  {(() => {
                    const imgs = Array.isArray(r.images) ? r.images : (() => { try { return JSON.parse(r.images || '[]'); } catch { return []; } })();
                    return imgs.length > 0
                      ? <Image src={imgs[0]} width={44} height={44} style={{ objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />
                      : <div style={{ width: 48, height: 44, background: 'var(--color-bg)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-tertiary)', fontSize: 11, flexShrink: 0 }}>无图</div>;
                  })()}
                  <span className="x-mcard-name">{r.name}</span>
                  {r._count > 1 && <Tag color="purple">{r._count}款</Tag>}
                </div>
                <div className="x-mcard-actions">
                  <Button icon={<EditOutlined />} onClick={() => openEdit(r)} title="编辑" />
                  <Popconfirm title="确定删除该商品？" onConfirm={() => handleDelete(r)} okText="确定" cancelText="取消">
                    <Button icon={<DeleteOutlined />} title="删除" />
                  </Popconfirm>
                </div>
              </div>
              <div className="x-mcard-grid">
                <div className="x-mcard-field"><span className="x-mcard-label">品牌</span><span className="x-mcard-value">{r.brand || '-'}</span></div>
                <div className="x-mcard-field"><span className="x-mcard-label">型号</span><span className="x-mcard-value">{r.model || '-'}</span></div>
                <div className="x-mcard-field"><span className="x-mcard-label">编码</span><span className="x-mcard-value">{r.code || '-'}</span></div>
                <div className="x-mcard-field"><span className="x-mcard-label">条码</span><span className="x-mcard-value">{r.barcode || '-'}</span></div>
                <div className="x-mcard-field"><span className="x-mcard-label">规格</span><span className="x-mcard-value">{r.spec || '-'}</span></div>
                <div className="x-mcard-field"><span className="x-mcard-label">分类</span><span className="x-mcard-value">{categoryMap[r.category]?.text || r.category || '-'}</span></div>
                <div className="x-mcard-field"><span className="x-mcard-label">类目</span><span className="x-mcard-value">{r.type || '-'}</span></div>
                <div className="x-mcard-field"><span className="x-mcard-label">售价</span><span className="x-mcard-value">¥{Number(r.price||0).toLocaleString()}</span></div>
                <div className="x-mcard-field"><span className="x-mcard-label">库存</span><span className="x-mcard-value">{r.stock || 0}</span></div>
              </div>
              {r.highlight && <div className="x-mcard-extra">{r.highlight}</div>}
            </div>
          ))}
        </div>
      ) : (
        <Card size="small" style={{ borderRadius: 'var(--radius-lg)', marginBottom: 0 }}
          styles={{ body: { padding: 0 } }}>
          <div className="app-data-table">
            <Table
              dataSource={paginated}
              columns={columns}
              rowKey={r => r.id}
              loading={loading}
              locale={{ emptyText: <EmptyState title="暂无商品" description="点击右上角「添加商品」录入" /> }}
              scroll={{ x: TABLE_SCROLL_X.dense }}
              size="middle"
              className="products-list-table"
              rowClassName={(_, idx) => idx % 2 === 0 ? 'app-row-even' : 'app-row-odd'}
              pagination={false}
              expandable={{
                expandedRowRender: (record) => (
                  <Table
                    dataSource={record._groupItems}
                    columns={columns.filter(c => c.title !== '名称')}
                    rowKey="id"
                    pagination={false}
                    size="middle"
                    rowClassName={(_, idx) => idx % 2 === 0 ? 'app-row-even' : 'app-row-odd'}
                  />
                ),
                rowExpandable: (record) => record._count > 1,
                expandRowByClick: true,
              }}
            />
          </div>
        </Card>
      )}

      {/* ===== 分页 ===== */}
      {filtered.length > 0 && (
        <div className="app-pagination-bar">
          <span className="app-pagination-total">共 {filtered.length} 条</span>
          <Pagination current={page} total={filtered.length} pageSize={pageSize} onChange={setPage} showSizeChanger={false} size="small" />
        </div>
      )}

      {/* ===== 编辑弹窗 ===== */}
      <Modal
        title={editing ? '编辑商品' : '添加商品'}
        open={modalOpen}
        onOk={() => handleSubmit(false)}
        onCancel={() => setModalOpen(false)}
        destroyOnClose
        className="modal-xl"
        okText="确定"
        cancelText="取消"
        footer={[
          <Button key="cancel" onClick={() => setModalOpen(false)}>取消</Button>,
          <Button key="saveKeep" onClick={() => handleSubmit(true)} loading={submitting}
            style={{ borderRadius: 8 }}>
            保存并继续添加
          </Button>,
          <Button key="save" type="primary" onClick={() => handleSubmit(false)} loading={submitting}
            style={{ borderRadius: 8, fontWeight: 600 }}>
            确定
          </Button>,
        ]}
        styles={{
          body: { maxHeight: 'calc(100vh - 56px)', overflowY: 'auto', paddingRight: 8 },
        }}
      >
        <Form form={form} layout="vertical" requiredMark="optional">
          <Row gutter={[16, 16]}>
            <Col xs={24} xl={16}>
              {/* ── 基本信息 ── */}
              <div className="edit-card">
                <div className="edit-card-title"><AppstoreOutlined /> 基本信息</div>
                <div className="edit-card-body">
                  <Row gutter={[16, 16]}>
                    <Col xs={24} md={12}>
                      <Form.Item name="name" label="商品名称" rules={[{ required: true, message: '请输入商品名称' }]} className="form-w-full">
                        <Input placeholder="如：商品名称" style={{ borderRadius: 8 }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="brand" label="品牌" className="form-w-full">
                        <Input placeholder="如：品牌名称" style={{ borderRadius: 8 }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="model" label="型号" className="form-w-full"><Input placeholder="如：8077" style={{ borderRadius: 8 }} /></Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="code" label="商品编码" className="form-w-full"><Input style={{ borderRadius: 8 }} /></Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="barcode" label="商品条码" className="form-w-full">
                        <Input placeholder="扫码枪录入或手填，可留空/重复" style={{ borderRadius: 8 }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="category" label="分类" rules={[{ required: true, message: '请选择分类' }]} className="form-w-full">
                        <Select style={{ borderRadius: 8 }}>
                          <Select.Option value="sample">样品</Select.Option>
                          <Select.Option value="gift">赠品</Select.Option>
                          <Select.Option value="order">订货</Select.Option>
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="type" label="类目" className="form-w-full">
                        <AutoComplete options={typeOptions} placeholder="如：手机 / 笔记本 / 耳机" allowClear style={{ borderRadius: 8 }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="unit" label="单位" initialValue="件" className="form-w-full"><Input style={{ borderRadius: 8 }} /></Form.Item>
                    </Col>
                  </Row>
                  <div className="edit-inline">
                    <Form.Item name="active" label="上架状态" valuePropName="checked" style={{ marginBottom: 0 }}>
                      <Switch checkedChildren="上架" unCheckedChildren="下架" />
                    </Form.Item>
                    <span className="edit-inline-hint">新建默认上架；下架后前台开单不可选此商品</span>
                  </div>
                </div>
              </div>

              {/* ── 多规格变体 ── */}
              <div className="edit-card">
                <div className="edit-card-title"><AppstoreOutlined /> 规格与价格变体</div>
                <div className="edit-card-body">
                  <div className="variant-editor">
                    <div className="variant-header">
                      <span className="variant-hint">为每个规格设置独立价格和库存（如：颜色 / 尺寸 / 型号）</span>
                      <Space size={8}>
                        <Button icon={<PlusOutlined />} onClick={addVariant} type="primary"
                          style={{ borderRadius: 6, fontWeight: 600 }}>
                          添加规格
                        </Button>
                        <Button icon={<CopyOutlined />} onClick={copyLastVariant} disabled={variants.length === 0}
                          style={{ borderRadius: 6 }}>
                          复制上一规格
                        </Button>
                      </Space>
                    </div>

                    {variants.map((vt, idx) => (
                      <div key={idx} className="variant-row">
                        <div className="variant-index">{idx + 1}</div>
                        <div className="variant-fields">
                          <div className="variant-field vf-spec">
                            <label className="vf-label">规格名称</label>
                            <div className="vf-input-wrap">
                              <Input value={vt.spec} onChange={e => updateVariant(idx, 'spec', e.target.value)} placeholder="如：颜色 / 尺寸 / 型号" style={{ borderRadius: 6 }} />
                            </div>
                          </div>
                          <div className="variant-field vf-price">
                            <label className="vf-label">售价 *</label>
                            <InputNumber value={vt.price} onChange={v => updateVariant(idx, 'price', v)} min={0} prefix="¥" placeholder="0" style={{ width: '100%', borderRadius: 6 }} />
                          </div>
                          <div className="variant-field vf-cost">
                            <label className="vf-label">进价</label>
                            <InputNumber value={vt.cost_price} onChange={v => updateVariant(idx, 'cost_price', v)} min={0} prefix="¥" placeholder="0" style={{ width: '100%', borderRadius: 6 }} />
                          </div>
                          <div className="variant-field vf-be">
                            <label className="vf-label">保本价</label>
                            <div className="vf-be-val">{vt.cost_price ? `¥${Math.round((Number(vt.cost_price) / (1 - margin)) * 100) / 100}` : '—'}</div>
                          </div>
                          <div className="variant-field vf-stock">
                            <label className="vf-label">库存</label>
                            <InputNumber value={vt.stock} onChange={v => updateVariant(idx, 'stock', v)} min={0} placeholder="0" style={{ width: '100%', borderRadius: 6 }} />
                          </div>
                        </div>
                        <Button size="small" danger icon={<MinusCircleOutlined />} onClick={() => removeVariant(idx)} disabled={variants.length <= 1} className="variant-del-btn" shape="circle" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── 库存与排序 ── */}
              <div className="edit-card">
                <div className="edit-card-title"><AppstoreOutlined /> 库存与排序</div>
                <div className="edit-card-body">
                  <Row gutter={[16, 16]}>
                    <Col xs={24} md={8}>
                      <Form.Item name="stock" label="库存数量" className="form-w-full">
                        <InputNumber min={0} placeholder="0" disabled style={{ width: '100%', borderRadius: 8 }} />
                      </Form.Item>
                      <div className="edit-field-hint">系统自动汇总各规格库存之和，不可手动修改</div>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item label="在途数量" className="form-w-full">
                        <InputNumber value={editing?.in_transit || 0} disabled style={{ width: '100%', borderRadius: 8 }} />
                        <div className="edit-field-hint">系统自动汇总，不可手动修改</div>
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="sort_order" label="排序(越小越靠前)" className="form-w-full">
                        <InputNumber min={0} placeholder="0" style={{ width: '100%', borderRadius: 8 }} />
                      </Form.Item>
                    </Col>
                  </Row>
                </div>
              </div>
            </Col>

            <Col xs={24} xl={8}>
              {/* ── 素材与描述 ── */}
              <div className="edit-card">
                <div className="edit-card-title"><AppstoreOutlined /> 素材与描述</div>
                <div className="edit-card-body">
                  <div className="edit-sub-title">商品图片</div>
                  <Form.Item name="images" noStyle>
                    <ImageUploadWidget uploading={uploading} onUpload={handleUpload} onRemove={removeImage} form={form} />
                  </Form.Item>
                  <div className="edit-sub-title">描述与备注</div>
                  <Form.Item name="highlight" label="商品亮点(前台展示)" className="form-w-full">
                    <Input.TextArea rows={2} placeholder="如：材质优良 / 限时优惠 / 热销爆款" style={{ borderRadius: 8 }} />
                  </Form.Item>
                  <Form.Item name="detail_desc" label="详细描述" className="form-w-full">
                    <Input.TextArea rows={3} placeholder="商品详细描述，前台商品详情页展示。支持换行。" style={{ borderRadius: 8 }} />
                  </Form.Item>
                  <Form.Item name="description" label="内部备注" className="form-w-full">
                    <Input placeholder="内部用途，前台不展示" style={{ borderRadius: 8 }} />
                  </Form.Item>
                </div>
              </div>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
}

// 图片上传组件
function ImageUploadWidget({ uploading, onUpload, onRemove, form }) {
  const [fileList, setFileList] = useState([]);

  const images = Form.useWatch('images', form) || [];

  const handleChange = ({ fileList: fl }) => {
    const done = fl.filter(f => f.status === 'done' || f.status === 'error');
    const uploading_ = fl.filter(f => f.status === 'uploading' || !f.status);
    if (uploading_.length > 0) {
      onUpload({ fileList: uploading_ });
      setFileList([]);
    } else {
      setFileList(done);
    }
  };

  return (
    <div>
      <Upload
        listType="picture-card"
        fileList={fileList}
        onChange={handleChange}
        beforeUpload={() => false}
        multiple
        accept="image/*"
        showUploadList={false}
      >
        <div>
          <UploadOutlined />
          <div style={{ marginTop: 4, fontSize: 12 }}>{uploading ? '上传中...' : '点击上传'}</div>
        </div>
      </Upload>

      {images.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
          {images.map((url, idx) => (
            <div key={idx} style={{ position: 'relative', width: 96, height: 96 }}>
              <Image src={url} width={96} height={96} style={{ objectFit: 'cover', borderRadius: 8 }} />
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                style={{ position: 'absolute', top: -8, right: -8, borderRadius: '50%', minWidth: 24, width: 24, height: 24, padding: 0 }}
                onClick={() => onRemove(idx)}
              />
              {idx === 0 && (
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(245,34,45,0.85)', color: 'var(--color-bg-white)', fontSize: 12, textAlign: 'center', borderRadius: '0 0 8px 8px', padding: '1px 0' }}>
                  主图
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {images.length === 0 && (
        <div style={{ color: 'var(--color-text-tertiary)', fontSize: 12, marginTop: 4 }}>建议上传 1-9 张图片，第一张为商品主图</div>
      )}
    </div>
  );
}
