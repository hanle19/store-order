import { useState, useEffect } from 'react';
import { Card, Table, Input, Switch, InputNumber, Button, Tag, message } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import api from '../api';

const STYLE = {
  primary: 'var(--color-primary)',
  text: 'var(--color-text)',
  textSecondary: 'var(--color-text-secondary)',
  textTertiary: 'var(--color-text-tertiary)',
};

const scopeLabel = { report: '日报字段', customer: '客资字段', computed: '计算字段' };
const typeLabel = { number: '数字', text: '文本', select: '选择', computed: '计算' };

export default function DailyFieldConfig() {
  const [config, setConfig] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/daily/field-config');
      if (res.data.success) setConfig(res.data.config || []);
    } catch (e) { message.error('加载失败'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const update = (id, patch) => {
    setConfig(cfg => cfg.map(c => c.id === id ? { ...c, ...patch } : c));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates = config.map(c => ({
        id: c.id, field_label: c.field_label, is_enabled: c.is_enabled, sort_order: c.sort_order,
      }));
      await api.put('/daily/field-config', { updates });
      message.success('字段配置已保存');
    } catch (e) { message.error('保存失败'); }
    finally { setSaving(false); }
  };

  const columns = [
    {
      title: '字段显示名', dataIndex: 'field_label',
      render: (v, r) => (
        <Input value={v} onChange={e => update(r.id, { field_label: e.target.value })} style={{ minHeight: 36 }} />
      ),
    },
    { title: '类型', dataIndex: 'field_type', width: 88, render: t => <Tag>{typeLabel[t] || t}</Tag> },
    { title: '作用域', dataIndex: 'scope', width: 104, render: s => <Tag color="blue">{scopeLabel[s] || s}</Tag> },
    {
      title: '启用', dataIndex: 'is_enabled', width: 80, align: 'center',
      render: (v, r) => (
        <Switch checked={!!v} onChange={ck => update(r.id, { is_enabled: ck ? 1 : 0 })} />
      ),
    },
    {
      title: '排序', dataIndex: 'sort_order', width: 88,
      render: (v, r) => (
        <InputNumber min={0} value={v} onChange={val => update(r.id, { sort_order: val || 0 })} className="w-xs" />
      ),
    },
  ];

  const groups = [
    { key: 'report', title: '日报字段（闭店填写）' },
    { key: 'customer', title: '客资字段（每接待一条）' },
    { key: 'computed', title: '计算字段（系统自动算，不可录入）' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>字段自定义</h2>
          <div style={{ color: STYLE.textTertiary, fontSize: 'var(--font-size-sm)', marginTop: 4 }}>修改显示名、启用/隐藏、调整排序。类型与作用域不可改。</div>
        </div>
        <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>保存配置</Button>
      </div>

      {groups.map(g => {
        const rows = config.filter(c => c.scope === g.key).sort((a, b) => a.sort_order - b.sort_order);
        if (!rows.length) return null;
        return (
          <Card key={g.key} size="small" style={{ marginBottom: 16, borderRadius: 10 }} title={g.title}>
            <Table rowKey="id" columns={columns} dataSource={rows} pagination={false} size="small" loading={loading} />
          </Card>
        );
      })}
    </div>
  );
}
