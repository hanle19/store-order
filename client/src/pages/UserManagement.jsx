import { useState, useEffect } from 'react';
import { Table, Button, Modal, Form, Input, Select, Tag, message, Space, Card, Tooltip, Grid } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, KeyOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import api from '../api';
import { useAuth } from '../context/AuthContext';

const roleMap = {
  admin: { color: 'red', text: '管理员' },
  boss: { color: 'blue', text: '老板' },
  sales: { color: 'green', text: '导购' }
};

export default function UserManagement() {
  const { user } = useAuth();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try { const res = await api.get('/users'); setUsers(res.data); }
    catch { message.error('加载失败'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = (record) => {
    setEditing(record);
    form.setFieldsValue(record);
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      if (editing) {
        await api.put(`/users/${editing.id}`, values);
        message.success('更新成功');
      } else {
        await api.post('/users', values);
        message.success('创建成功');
      }
      setModalOpen(false);
      load();
    } catch (err) {
      if (err.response) message.error(err.response.data?.error || '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  const resetPassword = async (id) => {
    try {
      await api.post(`/users/${id}/reset-password`);
      message.success('密码已重置为 123456');
    } catch { message.error('操作失败'); }
  };

  const deleteUser = (record) => {
    const currentUser = user || {};
    if (currentUser.id === record.id) {
      message.warning('不能删除自己的账号');
      return;
    }
    Modal.confirm({
      title: '确认删除',
      icon: <ExclamationCircleOutlined />,
      content: `确定要删除用户"${record.display_name}（${record.username}）"吗？\n\n删除后该用户将无法登录，但其历史销售数据将完整保留。`,
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await api.delete(`/users/${record.id}`);
          message.success('用户已删除');
          load();
        } catch (err) {
          message.error(err.response?.data?.error || '删除失败');
        }
      },
    });
  };

  const columns = [
    { title: '用户名', dataIndex: 'username', width: 112 },
    { title: '姓名', dataIndex: 'display_name', width: 80 },
    { title: '角色', dataIndex: 'role', width: 80,
      render: r => <Tag color={roleMap[r]?.color}>{roleMap[r]?.text}</Tag>
    },
    { title: '电话', dataIndex: 'phone', width: 120, render: v => v || '-' },
    { title: '状态', dataIndex: 'active', width: 64,
      render: v => v ? <Tag color="green">启用</Tag> : <Tag color="red">禁用</Tag>
    },
    { title: '创建时间', dataIndex: 'created_at', width: 160 },
    { title: '操作', width: 144, align: 'center',
      render: (_, r) => (
        <Space size={4}>
          <Tooltip title="编辑">
            <Button className="app-action-btn" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          </Tooltip>
          <Tooltip title="重置密码">
            <Button className="app-action-btn" icon={<KeyOutlined />} onClick={() => resetPassword(r.id)} />
          </Tooltip>
          <Tooltip title="删除">
            <Button className="app-action-btn" icon={<DeleteOutlined />} onClick={() => deleteUser(r)}
              style={r.id === (user || {}).id ? {} : {}}
            />
          </Tooltip>
        </Space>
      )
    },
  ];

  const renderMobileToolbar = () => (
    <Card className="x-mobile-toolbar-card" bodyStyle={{ padding: 12 }}>
      <div style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 12 }}>
        共 {users.length} 个用户
      </div>
      <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} className="x-mobile-full-btn"
        style={{ background: 'var(--color-primary)', borderColor: 'var(--color-primary)' }}>
        添加用户
      </Button>
    </Card>
  );

  const renderMobileList = () => (
    <Card style={{ borderRadius: 10 }} bodyStyle={{ padding: 12 }}>
      {users.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-secondary)' }}>暂无用户</div>
      ) : (
        <div className="x-mcard-list">
          {users.map((u) => (
            <div key={u.id} className="x-mcard" style={{ padding: 12 }}>
              <div className="x-mcard-head" style={{ alignItems: 'flex-start' }}>
                <div>
                  <span className="x-mcard-name">{u.display_name}</span>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginTop: 2 }}>
                    @{u.username}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <Tag color={roleMap[u.role]?.color}>{roleMap[u.role]?.text}</Tag>
                  {u.active ? <Tag color="green">启用</Tag> : <Tag color="red">禁用</Tag>}
                </div>
              </div>
              <div className="x-mcard-grid" style={{ marginTop: 10, rowGap: 8 }}>
                <div className="x-mcard-field" style={{ gridColumn: '1 / -1' }}>
                  <span className="x-mcard-label">电话</span>
                  <span className="x-mcard-value">{u.phone || '-'}</span>
                </div>
                <div className="x-mcard-field">
                  <span className="x-mcard-label">创建时间</span>
                  <span className="x-mcard-value" style={{ fontSize: 'var(--font-size-sm)' }}>{u.created_at?.slice(0, 10) || '-'}</span>
                </div>
              </div>
              <div className="x-mcard-foot" style={{ marginTop: 14, flexDirection: 'column' }}>
                <Button icon={<EditOutlined />} onClick={() => openEdit(u)} block>编辑</Button>
                <Button icon={<KeyOutlined />} onClick={() => resetPassword(u.id)} block>重置密码</Button>
                <Button danger icon={<DeleteOutlined />} onClick={() => deleteUser(u)} block>删除</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );

  return (
    <div>
      {isMobile ? (
        <>
          {renderMobileToolbar()}
          {renderMobileList()}
        </>
      ) : (
        <>
          <Card className="users-toolbar-card">
            <span style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>共 {users.length} 个用户</span>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}
              style={{ background: 'var(--color-primary)', borderColor: 'var(--color-primary)', height: 36, borderRadius: 6 }}>
              添加用户
            </Button>
          </Card>

          <Card style={{ borderRadius: 10 }} bodyStyle={{ padding: 0 }}>
            <Table
              className="app-data-table"
              dataSource={users}
              columns={columns}
              rowKey="id"
              loading={loading}
              size="middle"
              pagination={false}
              rowClassName={(_, i) => i % 2 === 0 ? 'app-row-even' : 'app-row-odd'}
            />
          </Card>
        </>
      )}

      <Modal
        title={editing ? '编辑用户' : '添加用户'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        confirmLoading={submitting}
        destroyOnClose
      >
        <Form form={form} layout="vertical" requiredMark="optional">
          <div className="edit-card">
            <div className="edit-card-title"><EditOutlined /> 账户信息</div>
            <div className="edit-card-body">
              <Form.Item name="username" label="用户名" rules={[{ required: true }]} className="form-w-full">
                <Input disabled={!!editing} style={{ borderRadius: 8 }} />
              </Form.Item>
              {!editing && (
                <Form.Item name="password" label="密码" rules={[{ required: true, min: 6 }]} className="form-w-full">
                  <Input.Password placeholder="至少6位" style={{ borderRadius: 8 }} />
                </Form.Item>
              )}
              <Form.Item name="display_name" label="姓名" rules={[{ required: true }]} className="form-w-full">
                <Input style={{ borderRadius: 8 }} />
              </Form.Item>
              <Form.Item name="role" label="角色" rules={[{ required: true }]} className="form-w-full">
                <Select style={{ borderRadius: 8 }}>
                  <Select.Option value="admin">管理员</Select.Option>
                  <Select.Option value="boss">老板</Select.Option>
                  <Select.Option value="sales">导购</Select.Option>
                </Select>
              </Form.Item>
              <Form.Item name="phone" label="电话" className="form-w-full"><Input style={{ borderRadius: 8 }} /></Form.Item>
              {editing && (
                <Form.Item name="active" label="状态" className="form-w-full">
                  <Select style={{ borderRadius: 8 }}>
                    <Select.Option value={1}>启用</Select.Option>
                    <Select.Option value={0}>禁用</Select.Option>
                  </Select>
                </Form.Item>
              )}
            </div>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
