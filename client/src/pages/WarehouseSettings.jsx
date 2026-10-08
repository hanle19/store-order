import { useState, useEffect, useRef } from 'react';
import { Button, Input, Space, message, Alert, Grid, Tag } from 'antd';
import {
  PlusOutlined, DeleteOutlined, ArrowUpOutlined, ArrowDownOutlined,
  ApartmentOutlined, SaveOutlined,
} from '@ant-design/icons';
import api from '../api';
import { useBrand, useWarehouses } from '../context/BrandContext';

export default function WarehouseSettings() {
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const { reload } = useBrand();
  const warehouses = useWarehouses();

  const idRef = useRef(1);
  const nextId = () => `w_${idRef.current++}`;

  const [list, setList] = useState([]);
  const [saving, setSaving] = useState(false);

  // 初次挂载时以当前配置初始化可编辑列表（Tab 首次打开时品牌配置已就绪）
  useEffect(() => {
    setList(warehouses.map(w => ({ id: nextId(), name: w })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeName = (id, val) =>
    setList(prev => prev.map(r => (r.id === id ? { ...r, name: val } : r)));

  const addRow = () => setList(prev => [...prev, { id: nextId(), name: '' }]);

  const removeRow = (id) => setList(prev => prev.filter(r => r.id !== id));

  const move = (index, dir) => setList(prev => {
    const target = index + dir;
    if (target < 0 || target >= prev.length) return prev;
    const copy = [...prev];
    [copy[index], copy[target]] = [copy[target], copy[index]];
    return copy;
  });

  const handleSave = async () => {
    const names = list.map(r => r.name.trim());
    // 校验：至少一项、去空、去重
    const filled = names.filter(Boolean);
    if (filled.length === 0) {
      message.warning('请至少保留一个库房');
      return;
    }
    const dup = filled.filter((n, i) => filled.indexOf(n) !== i);
    if (dup.length > 0) {
      message.warning(`库房名称不可重复：${dup[0]}`);
      return;
    }
    setSaving(true);
    try {
      await api.put('/config', { warehouses: JSON.stringify(filled) });
      await reload();
      message.success('库房设置已保存');
      // 以保存结果回写编辑态，保证顺序一致
      setList(filled.map(w => ({ id: nextId(), name: w })));
    } catch (e) {
      message.error(e.response?.data?.error || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16, borderRadius: 8 }}
        message="此处维护「到货仓库 / 物流仓库」下拉选项，进货单、到货确认、订单进货弹窗均会按此列表展示。"
      />

      <div className="edit-card">
        <div className="edit-card-title">
          <ApartmentOutlined /> 库房列表
          <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 400, color: 'var(--color-text-tertiary)' }}>
            共 {list.length} 项
          </span>
        </div>
        <div className="edit-card-body">
          {list.length === 0 ? (
            <div style={{ padding: '12px 0', color: 'var(--color-text-tertiary)', fontSize: 'var(--font-size-sm)' }}>
              暂无库房，点击下方「添加库房」新增
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {list.map((row, idx) => (
                <div
                  key={row.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    flexWrap: isMobile ? 'wrap' : 'nowrap',
                  }}
                >
                  <span
                    style={{
                      minWidth: 24, textAlign: 'center', fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-text-tertiary)', fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {idx + 1}
                  </span>
                  <Input
                    value={row.name}
                    maxLength={20}
                    placeholder="请输入库房名称"
                    onChange={e => changeName(row.id, e.target.value)}
                    style={{ flex: 1, minWidth: 160, height: 38, borderRadius: 8 }}
                  />
                  <Space size={4} wrap>
                    <Button
                      icon={<ArrowUpOutlined />} disabled={idx === 0}
                      onClick={() => move(idx, -1)} title="上移"
                      style={{ height: 38, borderRadius: 8 }}
                    />
                    <Button
                      icon={<ArrowDownOutlined />} disabled={idx === list.length - 1}
                      onClick={() => move(idx, 1)} title="下移"
                      style={{ height: 38, borderRadius: 8 }}
                    />
                    <Button
                      danger icon={<DeleteOutlined />}
                      onClick={() => removeRow(row.id)} title="删除"
                      style={{ height: 38, borderRadius: 8 }}
                    />
                  </Space>
                </div>
              ))}
            </div>
          )}

          <Button
            type="dashed"
            icon={<PlusOutlined />}
            onClick={addRow}
            block
            style={{ marginTop: 12, height: 38, borderRadius: 8, borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
          >
            添加库房
          </Button>
        </div>
      </div>

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          loading={saving}
          onClick={handleSave}
          style={{ height: 38, borderRadius: 8, background: 'var(--color-primary)', borderColor: 'var(--color-primary)' }}
        >
          保存库房设置
        </Button>
      </div>
    </div>
  );
}
