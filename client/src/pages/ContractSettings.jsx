import { useState, useEffect } from 'react';
import { Form, Input, Button, Card, message, Spin } from 'antd';
import { SaveOutlined, FileTextOutlined } from '@ant-design/icons';
import api from '../api';

const { TextArea } = Input;

export default function ContractSettings() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const res = await api.get('/config');
      form.setFieldsValue(res.data);
    } catch (e) {
      message.error('加载配置失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (values) => {
    setSaving(true);
    try {
      await api.put('/config', values);
      message.success('合同配置已保存');
    } catch (e) {
      message.error(e.response?.data?.error || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Spin spinning={loading}>
      <Card className="contract-hint-card">
        <div style={{ fontSize: 'var(--font-size-sm)', color: '#8E8E93' }}>
          以下配置将实时应用于销售合同模板。修改后保存，下次生成合同即可生效。
        </div>
      </Card>

      <Card style={{ borderRadius: 10 }}>
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSave}
          initialValues={{
            store_name: '我的门店',
            store_address: '',
            store_phone: '',
            contract_terms: '',
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Form.Item
              name="store_name"
              label="店铺名称"
              rules={[{ required: true, message: '请输入店铺名称' }]}
            >
              <Input placeholder="例如：我的门店" />
            </Form.Item>
            <Form.Item name="store_phone" label="店铺电话">
              <Input placeholder="例如：0351-8888888" />
            </Form.Item>
          </div>
          <Form.Item name="store_address" label="店铺地址">
            <Input placeholder="例如：太原市小店区长风街红星美凯龙五层" />
          </Form.Item>

          <Form.Item
            name="contract_terms"
            label={<span><FileTextOutlined style={{ marginRight: 6 }} />协议条款</span>}
            rules={[{ required: true, message: '请输入协议条款' }]}
            extra={'每行一条条款，以数字开头自动编号。合同中\u201c定金不予退还\u201d\u201c逾期费用\u201d等关键规则可适当用 **文字** 加粗提示。'}
          >
            <TextArea
              rows={10}
              placeholder={'1. 定货周期：常规商品30天，定制商品45天，从付定金次日起算。\n2. 客户支付定金后，本店开始排产/采购；如客户中途取消订单，定金不予退还。\n3. 货到后客户需在7日内结清尾款并安排送货，逾期每日收取仓管费（货值万分之三）。\n4. 送货安装完成后如无质量问题，不接受退货。\n5. 本合同一式两份，双方各执一份，具有同等法律效力。'}
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button className="contract-save-btn" type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving}>
              保存配置
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </Spin>
  );
}
