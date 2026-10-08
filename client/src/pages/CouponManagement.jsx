import { TABLE_SCROLL_X } from '../components/tableConstants';
import { useState, useEffect } from 'react';
import dayjs from 'dayjs';
import { Card, Table, Button, Modal, Form, Input, InputNumber, Select, Switch, Space, Tag, message, Popconfirm, DatePicker } from 'antd';
import { PlusOutlined, DeleteOutlined, CopyOutlined, TagOutlined } from '@ant-design/icons';
import api from '../api';

const typeMap = { full_reduce: { text: '满减', color: 'blue' }, discount: { text: '折扣', color: 'purple' }, instant: { text: '立减', color: 'green' } };
const scopeMap = { all: '全部商品', category: '指定分类', product: '指定商品' };
const channelMap = { all: { text: '通用', color: 'default' }, douyin: { text: '抖音', color: 'volcano' } };

export default function CouponManagement() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [type, setType] = useState('full_reduce');

  const load = async () => {
    setLoading(true);
    try { const r = await api.get('/coupons'); setList(r.data || []); }
    catch { message.error('加载失败'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ type: 'full_reduce', scope: 'all', channel: 'all', total_qty: 0, status: true });
    setType('full_reduce');
    setOpen(true);
  };
  const openEdit = (r) => {
    setEditing(r);
    form.setFieldsValue({
      ...r,
      channel: r.channel || 'all',
      start: r.start ? dayjs(r.start) : null,
      end: r.end ? dayjs(r.end) : null,
      status: r.status === 1,
    });
    setType(r.type);
    setOpen(true);
  };

  const submit = async () => {
    try {
      const v = await form.validateFields();
      setSaving(true);
      const payload = {
        ...v,
        channel: v.channel || 'all',
        start: v.start ? v.start.format('YYYY-MM-DD') : '',
        end: v.end ? v.end.format('YYYY-MM-DD') : '',
        status: v.status ? 1 : 0,
        total_qty: Number(v.total_qty) || 0,
      };
      if (editing) { await api.put(`/coupons/${editing.code}`, payload); message.success('更新成功'); }
      else { await api.post('/coupons', payload); message.success('创建成功'); }
      setOpen(false); load();
    } catch (e) {
      if (e.response) message.error(e.response.data?.error || '保存失败');
    } finally { setSaving(false); }
  };

  const del = async (code) => {
    try { await api.delete(`/coupons/${code}`); message.success('删除成功'); load(); }
    catch (e) { message.error(e.response?.data?.error || '删除失败'); }
  };
  const copy = (code) => { navigator.clipboard?.writeText(code); message.success('券码已复制'); };

  const columns = [
    { title: '券码', dataIndex: 'code', width: 128, render: (c) => <Space>{c}<Button icon={<CopyOutlined />} onClick={() => copy(c)} /></Space> },
    { title: '类型', dataIndex: 'type', width: 72, render: (t) => <Tag color={typeMap[t]?.color}>{typeMap[t]?.text}</Tag> },
    { title: '面值/折扣', key: 'val', width: 112, render: (r) => r.type === 'discount' ? `打${Math.round(Number(r.value) * 100) / 10}折` : `减¥${Number(r.value)}` },
    { title: '门槛', key: 'th', width: 88, render: (r) => r.threshold > 0 ? `满¥${r.threshold}` : '无门槛' },
    { title: '适用', dataIndex: 'scope', width: 88, render: (s) => scopeMap[s] || s },
    { title: '渠道', dataIndex: 'channel', width: 80, render: (c) => <Tag color={channelMap[c]?.color}>{channelMap[c]?.text || '通用'}</Tag> },
    { title: '有效期', key: 'exp', width: 184, render: (r) => `${r.start || '不限'} ~ ${r.end || '不限'}` },
    { title: '已用/总量', key: 'use', width: 88, render: (r) => `${r.used_qty}/${r.total_qty || '∞'}` },
    { title: '状态', dataIndex: 'status', width: 72, render: (s) => <Tag color={s === 1 ? 'var(--status-done)' : 'var(--status-cancel)'}>{s === 1 ? '启用' : '停用'}</Tag> },
    { title: '操作', key: 'act', width: 128, render: (_, r) => (
      <Space>
        <Button onClick={() => openEdit(r)}>编辑</Button>
        <Popconfirm title="确定删除？" onConfirm={() => del(r.code)}><Button danger>删除</Button></Popconfirm>
      </Space>
    ) },
  ];

  return (
    <Card size="small" style={{ borderRadius: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontWeight: 600 }}>优惠券管理</span>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建券</Button>
      </div>
      <Table dataSource={list} columns={columns} rowKey="code" loading={loading} pagination={false} size="small" scroll={{ x: TABLE_SCROLL_X.compact }} />
      <Modal className="modal-md" title={editing ? '编辑券' : '新建券'} open={open} onOk={submit} onCancel={() => setOpen(false)} confirmLoading={saving} destroyOnClose>
        <Form form={form} layout="vertical" requiredMark="optional">
          <div className="edit-card">
            <div className="edit-card-title"><TagOutlined /> 券设置</div>
            <div className="edit-card-body">
              <Form.Item name="code" label="券码（留空自动生成）" className="form-w-full">
                <Input placeholder="如 SAVE50，留空自动生成" style={{ borderRadius: 8 }} />
              </Form.Item>
              <Form.Item name="type" label="类型" rules={[{ required: true }]} className="form-w-full">
                <Select onChange={setType} style={{ borderRadius: 8 }}>
                  <Select.Option value="full_reduce">满减</Select.Option>
                  <Select.Option value="discount">折扣</Select.Option>
                  <Select.Option value="instant">立减（无门槛）</Select.Option>
                </Select>
              </Form.Item>
              {type === 'discount' ? (
                <Form.Item name="value" label="折扣（0.1~0.95，0.9=9折）" rules={[{ required: true }]} className="form-w-full">
                  <InputNumber min={0.1} max={0.95} step={0.05} style={{ width: '100%', borderRadius: 8 }} />
                </Form.Item>
              ) : (
                <Form.Item name="value" label={type === 'full_reduce' ? '减免金额(¥)' : '立减金额(¥)'} rules={[{ required: true }]} className="form-w-full">
                  <InputNumber min={0} step={1} style={{ width: '100%', borderRadius: 8 }} />
                </Form.Item>
              )}
              <Form.Item name="threshold" label="使用门槛（满¥，0=无门槛）" className="form-w-full">
                <InputNumber min={0} style={{ width: '100%', borderRadius: 8 }} />
              </Form.Item>
              <Form.Item name="scope" label="适用范围" rules={[{ required: true }]} className="form-w-full">
                <Select style={{ borderRadius: 8 }}>
                  <Select.Option value="all">全部商品</Select.Option>
                  <Select.Option value="category">指定分类</Select.Option>
                  <Select.Option value="product">指定商品</Select.Option>
                </Select>
              </Form.Item>
              <Form.Item name="channel" label="适用渠道" rules={[{ required: true }]} className="form-w-full">
                <Select style={{ borderRadius: 8 }}>
                  <Select.Option value="all">通用（门店/前台）</Select.Option>
                  <Select.Option value="douyin">抖音（抖音订单自动核销）</Select.Option>
                </Select>
              </Form.Item>
              <Form.Item name="scope_ids" label="适用分类/商品ID（逗号分隔，适用范围非“全部”时填写）" className="form-w-full">
                <Input placeholder="如 订货 或 12,15" style={{ borderRadius: 8 }} />
              </Form.Item>
            </div>
          </div>
          <div className="edit-card">
            <div className="edit-card-title"><TagOutlined /> 有效期与发放</div>
            <div className="edit-card-body">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                <Form.Item name="start" label="开始日期" className="form-w-full"><DatePicker style={{ width: '100%', borderRadius: 8 }} /></Form.Item>
                <Form.Item name="end" label="结束日期" className="form-w-full"><DatePicker style={{ width: '100%', borderRadius: 8 }} /></Form.Item>
              </div>
              <Form.Item name="total_qty" label="发放总量（0=不限量）" className="form-w-full">
                <InputNumber min={0} style={{ width: '100%', borderRadius: 8 }} />
              </Form.Item>
              <Form.Item name="status" label="启用" valuePropName="checked" className="form-w-full"><Switch /></Form.Item>
            </div>
          </div>
        </Form>
      </Modal>
    </Card>
  );
}
