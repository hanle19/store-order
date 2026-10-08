import { useState, useEffect, useCallback } from 'react';
import { Table, Button, Modal, Form, Input, Space, Tag, message, Card } from 'antd';
import { PlusOutlined, EditOutlined, ShopOutlined } from '@ant-design/icons';
import api from '../api';
import { useStore } from '../context/StoreContext';

export default function StoreManagement() {
  const { refreshStores } = useStore();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/stores');
      setList(res.data?.stores || []);
    } catch (e) {
      message.error('加载门店列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAdd = () => {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  };

  const handleEdit = (record) => {
    setEditing(record);
    form.setFieldsValue(record);
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      if (editing) {
        await api.put(`/stores/${editing.id}`, values);
        message.success('修改成功');
      } else {
        await api.post('/stores', values);
        message.success('新增成功');
      }
      setModalOpen(false);
      load();
      refreshStores();
    } catch (e) {
      if (e.errorFields) return; // 表单校验
      message.error(e.response?.data?.error || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (id) => {
    try {
      await api.post(`/stores/${id}/toggle`);
      load();
      refreshStores();
    } catch (e) {
      message.error(e.response?.data?.error || '操作失败');
    }
  };

  const columns = [
    { title: '门店名称', dataIndex: 'name', width: 200 },
    { title: '门店编码', dataIndex: 'code', width: 120 },
    { title: '地址', dataIndex: 'address', ellipsis: true },
    { title: '电话', dataIndex: 'phone', width: 140 },
    { title: '负责人', dataIndex: 'manager_name', width: 120 },
    {
      title: '状态', dataIndex: 'is_active', width: 100,
      render: (v) => v ? <Tag color="green">启用</Tag> : <Tag color="red">停用</Tag>,
    },
    {
      title: '操作', width: 160,
      render: (_, r) => (
        <Space>
          <Button size="small" type="link" icon={<EditOutlined />} onClick={() => handleEdit(r)}>编辑</Button>
          <Button
            size="small"
            type="link"
            danger={r.is_active}
            onClick={() => handleToggle(r.id)}
          >
            {r.is_active ? '停用' : '启用'}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card className="store-toolbar-card">
        <span style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>共 {list.length} 家门店</span>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>新增门店</Button>
      </Card>
      <Card style={{ borderRadius: 10 }} bodyStyle={{ padding: 0 }}>
        <Table
          className="app-data-table"
          columns={columns}
          dataSource={list}
          rowKey="id"
          loading={loading}
          pagination={false}
          size="middle"
          scroll={{ x: 800 }}
          rowClassName={(_, i) => i % 2 === 0 ? 'app-row-even' : 'app-row-odd'}
        />
      </Card>
      <Modal
        title={editing ? '编辑门店' : '新增门店'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" requiredMark="optional" preserve={false} style={{ marginTop: 16 }}>
          <div className="edit-card">
            <div className="edit-card-title"><ShopOutlined /> 门店信息</div>
            <div className="edit-card-body">
              <Form.Item name="name" label="门店名称" rules={[{ required: true, message: '请输入门店名称' }]} className="form-w-full">
                <Input placeholder="如：晚安家居·长风店" style={{ borderRadius: 'var(--radius-md)' }} />
              </Form.Item>
              <Form.Item name="code" label="门店编码" className="form-w-full">
                <Input placeholder="如：CF001" style={{ borderRadius: 'var(--radius-md)' }} />
              </Form.Item>
              <Form.Item name="address" label="门店地址" className="form-w-full">
                <Input placeholder="详细地址" style={{ borderRadius: 'var(--radius-md)' }} />
              </Form.Item>
              <Form.Item name="phone" label="联系电话" className="form-w-full">
                <Input placeholder="门店电话" style={{ borderRadius: 'var(--radius-md)' }} />
              </Form.Item>
            </div>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
