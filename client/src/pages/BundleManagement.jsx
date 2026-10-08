import { useState, useEffect } from 'react';
import dayjs from 'dayjs';
import { formatMoneyInt } from '../utils/format';
import { Card, Table, Button, Modal, Form, Input, InputNumber, Select, Space, Tag, message, Popconfirm, DatePicker, Switch } from 'antd';
import { PlusOutlined, DeleteOutlined, GiftOutlined } from '@ant-design/icons';
import api from '../api';

// 模块级：_uid 必须全局唯一。若写在组件内，每次渲染都会重置计数器，
// 导致不同批次生成的 _uid 重复（key 冲突）。
let uidSeq = 0;
// 列表行稳定 key：套餐商品可增删，用数组下标做 key 会在删除中间行后错位。
// _uid 仅前端使用，提交前剥离（见 submit）。
const newItem = (over = {}) => ({ _uid: `bi${++uidSeq}`, product_id: undefined, qty: 1, is_main: false, ...over });

export default function BundleManagement() {
  const [list, setList] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [items, setItems] = useState([]);

  const load = async () => {
    setLoading(true);
    try { const r = await api.get('/bundles'); setList(r.data || []); }
    catch { message.error('加载失败'); } finally { setLoading(false); }
  };
  const loadProducts = async () => {
    try { const r = await api.get('/products'); setProducts(r.data || []); } catch { /* ignore */ }
  };
  useEffect(() => { load(); loadProducts(); }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ status: true });
    setItems([newItem({ is_main: true })]);
    setOpen(true);
  };
  const openEdit = (r) => {
    setEditing(r);
    form.setFieldsValue({
      ...r,
      start: r.start ? dayjs(r.start) : null,
      end: r.end ? dayjs(r.end) : null,
      status: r.status === 1,
    });
    setItems((r.items || []).map(it => newItem({ product_id: it.product_id, qty: it.qty, is_main: it.is_main === 1 })));
    setOpen(true);
  };

  const updateItem = (i, field, val) => {
    const next = [...items];
    next[i] = { ...next[i], [field]: val };
    if (field === 'is_main' && val) next.forEach((it, j) => { if (j !== i) it.is_main = false; });
    setItems(next);
  };

  const submit = async () => {
    try {
      const v = await form.validateFields();
      if (!items.length || items.some(it => !it.product_id)) { message.warning('请至少添加一个有效商品'); return; }
      setSaving(true);
      const payload = {
        ...v,
        start: v.start ? v.start.format('YYYY-MM-DD') : '',
        end: v.end ? v.end.format('YYYY-MM-DD') : '',
        status: v.status ? 1 : 0,
        items: items.map(({ _uid, ...rest }) => rest), // 剥离前端专用 key，避免多余字段入库
      };
      if (editing) { await api.put(`/bundles/${editing.id}`, payload); message.success('更新成功'); }
      else { await api.post('/bundles', payload); message.success('创建成功'); }
      setOpen(false); load();
    } catch (e) {
      if (e.response) message.error(e.response.data?.error || '保存失败');
    } finally { setSaving(false); }
  };

  const del = async (id) => {
    try { await api.delete(`/bundles/${id}`); message.success('删除成功'); load(); }
    catch (e) { message.error(e.response?.data?.error || '删除失败'); }
  };

  const columns = [
    { title: '套餐名', dataIndex: 'name' },
    { title: '组合价', dataIndex: 'combo_price', width: 112, render: (v) => formatMoneyInt(v) },
    { title: '商品数', key: 'cnt', width: 80, render: (r) => (r.items || []).length },
    { title: '有效期', key: 'exp', width: 184, render: (r) => `${r.start || '不限'} ~ ${r.end || '不限'}` },
    { title: '状态', dataIndex: 'status', width: 72, render: (s) => <Tag color={s === 1 ? 'var(--status-done)' : 'var(--status-cancel)'}>{s === 1 ? '启用' : '停用'}</Tag> },
    { title: '操作', key: 'act', width: 128, render: (_, r) => (
      <Space>
        <Button onClick={() => openEdit(r)}>编辑</Button>
        <Popconfirm title="确定删除？" onConfirm={() => del(r.id)}><Button danger>删除</Button></Popconfirm>
      </Space>
    ) },
  ];

  const productOptions = products.map(p => ({ value: p.id, label: `${p.name}${p.brand ? '（' + p.brand + '）' : ''}` }));

  return (
    <Card size="small" style={{ borderRadius: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontWeight: 600 }}>捆绑套餐管理</span>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建套餐</Button>
      </div>
      <Table dataSource={list} columns={columns} rowKey="id" loading={loading} pagination={false} size="small" />
      <Modal className="modal-md" title={editing ? '编辑套餐' : '新建套餐'} open={open} onOk={submit} onCancel={() => setOpen(false)} confirmLoading={saving} destroyOnClose>
        <Form form={form} layout="vertical" requiredMark="optional">
          <div className="edit-card">
            <div className="edit-card-title"><GiftOutlined /> 套餐信息</div>
            <div className="edit-card-body">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                <Form.Item name="name" label="套餐名称" rules={[{ required: true }]} className="form-w-full">
                  <Input placeholder="如 床垫+枕头套装" style={{ borderRadius: 8 }} />
                </Form.Item>
                <Form.Item name="combo_price" label="组合价(¥)" rules={[{ required: true }]} className="form-w-full">
                  <InputNumber min={0} style={{ width: '100%', borderRadius: 8 }} />
                </Form.Item>
                <Form.Item name="category" label="适用分类(可选)" className="form-w-full">
                  <Input placeholder="如 订货" style={{ borderRadius: 8 }} />
                </Form.Item>
                <Form.Item name="brand" label="适用品牌(可选)" className="form-w-full">
                  <Input placeholder="如 晚安" style={{ borderRadius: 8 }} />
                </Form.Item>
                <Form.Item name="start" label="开始日期" className="form-w-full">
                  <DatePicker style={{ width: '100%', borderRadius: 8 }} />
                </Form.Item>
                <Form.Item name="end" label="结束日期" className="form-w-full">
                  <DatePicker style={{ width: '100%', borderRadius: 8 }} />
                </Form.Item>
              </div>
              <Form.Item name="status" label="启用" valuePropName="checked" className="form-w-full">
                <Switch />
              </Form.Item>
            </div>
          </div>
          <div className="edit-card">
            <div className="edit-card-title"><GiftOutlined /> 套餐商品</div>
            <div className="edit-card-body">
              <div className="edit-sub-title">套餐商品（勾选"主商品"作为套餐代表）</div>
              {items.map((it, i) => (
                <div key={it._uid || i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <Select value={it.product_id} onChange={(v) => updateItem(i, 'product_id', v)} options={productOptions} placeholder="选择商品" style={{ flex: 1, borderRadius: 8 }} showSearch optionFilterProp="label" />
                  <InputNumber min={1} value={it.qty} onChange={(v) => updateItem(i, 'qty', v)} placeholder="数量" className="w-xs" style={{ borderRadius: 8 }} />
                  <Button type={it.is_main ? 'primary' : 'default'} onClick={() => updateItem(i, 'is_main', true)}>主商品</Button>
                  <Button danger icon={<DeleteOutlined />} onClick={() => setItems(items.filter((_, j) => j !== i))} disabled={items.length <= 1} />
                </div>
              ))}
              <Button type="dashed" icon={<PlusOutlined />} onClick={() => setItems([...items, newItem()])}>添加商品</Button>
            </div>
          </div>
        </Form>
      </Modal>
    </Card>
  );
}
