import { useState, useEffect, useCallback } from 'react';
import { Table, Button, Modal, Form, Input, Space, message, Tag, Popconfirm, Card, Tooltip, Grid } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, PhoneOutlined, UserOutlined } from '@ant-design/icons';
import api from '../api';

export default function DeliveryPersons() {
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const [persons, setPersons] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const fetchPersons = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/delivery-persons');
      setPersons(res.data?.data || []);
    } catch (e) {
      message.error('加载配送师傅列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPersons(); }, [fetchPersons]);

  const openAdd = () => {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = (record) => {
    setEditing(record);
    form.setFieldsValue({ name: record.name, phone: record.phone || '', note: record.note || '' });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      if (editing) {
        await api.put(`/delivery-persons/${editing.id}`, values);
        message.success('更新成功');
      } else {
        await api.post('/delivery-persons', values);
        message.success('添加成功');
      }
      setModalOpen(false);
      fetchPersons();
    } catch (e) {
      message.error(e.response?.data?.error || '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/delivery-persons/${id}`);
      message.success('已删除');
      fetchPersons();
    } catch (e) {
      message.error(e.response?.data?.error || '删除失败');
    }
  };

  const columns = [
    {
      title: '师傅姓名',
      dataIndex: 'name',
      width: 144,
      render: (text) => (
        <span style={{ fontWeight: 600 }}>
          <UserOutlined style={{ marginRight: 6, color: 'var(--color-primary)' }} />
          {text}
        </span>
      ),
    },
    {
      title: '联系电话',
      dataIndex: 'phone',
      width: 160,
      render: (text) => text ? (
        <span>
          <PhoneOutlined style={{ marginRight: 6, color: 'var(--color-text-tertiary)' }} />
          {text}
        </span>
      ) : <Tag color="default">未填写</Tag>,
    },
    {
      title: '备注',
      dataIndex: 'note',
      ellipsis: { showTitle: false },
      render: (text) => text ? <Tooltip title={text}><span style={{ color: 'var(--color-text-tertiary)' }}>{text}</span></Tooltip>
        : <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 112,
      render: (text) => text?.slice(0, 10),
    },
    {
      title: '操作',
      width: 104,
      align: 'center',
      render: (_, record) => (
        <Space size={4}>
          <Tooltip title="编辑">
            <Button className="app-action-btn" icon={<EditOutlined />} onClick={() => openEdit(record)} />
          </Tooltip>
          <Popconfirm
            title="确定删除该配送师傅？"
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Tooltip title="删除">
              <Button className="app-action-btn" icon={<DeleteOutlined />}
                style={{ color: 'var(--color-error)', borderColor: 'var(--color-error)' }} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const renderMobileToolbar = () => (
    <Card className="x-mobile-toolbar-card" bodyStyle={{ padding: 12 }}>
      <div style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 12 }}>
        共 {persons.length} 位配送师傅
      </div>
      <Button type="primary" icon={<PlusOutlined />} onClick={openAdd} className="x-mobile-full-btn"
        style={{ background: 'var(--color-primary)', borderColor: 'var(--color-primary)' }}>
        添加师傅
      </Button>
    </Card>
  );

  const renderMobileList = () => (
    <Card style={{ borderRadius: 10 }} bodyStyle={{ padding: 12 }}>
      {persons.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
          暂无配送师傅，点击右上角添加
        </div>
      ) : (
        <div className="x-mcard-list">
          {persons.map((p) => (
            <div key={p.id} className="x-mcard" style={{ padding: 12 }}>
              <div className="x-mcard-head">
                <span className="x-mcard-name">
                  <UserOutlined style={{ marginRight: 6, color: 'var(--color-primary)' }} />
                  {p.name}
                </span>
              </div>
              <div className="x-mcard-grid" style={{ marginTop: 8, rowGap: 8 }}>
                <div className="x-mcard-field" style={{ gridColumn: '1 / -1' }}>
                  <span className="x-mcard-label">联系电话</span>
                  <span className="x-mcard-value">
                    {p.phone ? (
                      <><PhoneOutlined style={{ marginRight: 4, color: 'var(--color-text-tertiary)' }} />{p.phone}</>
                    ) : <Tag color="default">未填写</Tag>}
                  </span>
                </div>
                {p.note && (
                  <div className="x-mcard-field" style={{ gridColumn: '1 / -1' }}>
                    <span className="x-mcard-label">备注</span>
                    <span className="x-mcard-value" style={{ color: 'var(--color-text-secondary)' }}>{p.note}</span>
                  </div>
                )}
                <div className="x-mcard-field">
                  <span className="x-mcard-label">创建时间</span>
                  <span className="x-mcard-value">{p.created_at?.slice(0, 10) || '-'}</span>
                </div>
              </div>
              <div className="x-mcard-foot" style={{ marginTop: 12 }}>
                <Button icon={<EditOutlined />} onClick={() => openEdit(p)}>编辑</Button>
                <Popconfirm
                  title="确定删除该配送师傅？"
                  onConfirm={() => handleDelete(p.id)}
                  okText="确定"
                  cancelText="取消"
                >
                  <Button danger icon={<DeleteOutlined />}>删除</Button>
                </Popconfirm>
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
          <Card className="delivery-toolbar-card">
            <span style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>共 {persons.length} 位配送师傅</span>
            <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}
              style={{ background: 'var(--color-primary)', borderColor: 'var(--color-primary)', height: 36, borderRadius: 6 }}>
              添加师傅
            </Button>
          </Card>

          <Card style={{ borderRadius: 10 }} bodyStyle={{ padding: 0 }}>
            <Table
              className="app-data-table"
              dataSource={persons}
              columns={columns}
              rowKey="id"
              loading={loading}
              size="middle"
              pagination={false}
              rowClassName={(_, i) => i % 2 === 0 ? 'app-row-even' : 'app-row-odd'}
              locale={{ emptyText: '暂无配送师傅，点击右上角添加' }}
            />
          </Card>
        </>
      )}

      <Modal
        title={editing ? '编辑配送师傅' : '添加配送师傅'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        confirmLoading={submitting}
        destroyOnClose
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" requiredMark="optional">
          <div className="edit-card">
            <div className="edit-card-title"><UserOutlined /> 师傅信息</div>
            <div className="edit-card-body">
              <Form.Item
                name="name"
                label="师傅姓名"
                rules={[{ required: true, message: '请输入师傅姓名' }]}
                className="form-w-full"
              >
                <Input placeholder="如：张师傅" maxLength={20} style={{ borderRadius: 8 }} />
              </Form.Item>
              <Form.Item name="phone" label="联系电话" className="form-w-full">
                <Input placeholder="如：13800138000" maxLength={20} style={{ borderRadius: 8 }} />
              </Form.Item>
              <Form.Item name="note" label="备注" className="form-w-full">
                <Input.TextArea rows={2} placeholder="可选备注信息" maxLength={100} style={{ borderRadius: 8 }} />
              </Form.Item>
            </div>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
