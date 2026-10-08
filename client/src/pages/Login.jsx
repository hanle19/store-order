import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, Card, message } from 'antd';
import { UserOutlined, LockOutlined, HomeOutlined } from '@ant-design/icons';
import api from '../api';
import { useBrand } from '../context/BrandContext';
import { useAuth } from '../context/AuthContext';

const COLORS = {
  primary: 'var(--color-primary)',
  bg: '#F6F4F2',
  text: '#333333',
  border: '#EAE6E2',
};

export default function Login() {
  const [loading, setLoading] = useState(false);
  const { brand } = useBrand();
  const { setUser } = useAuth();
  const siteName = brand.site_name || '门店系统';
  const navigate = useNavigate();

  const onFinish = async (values) => {
    setLoading(true);
    try {
      const res = await api.post('/auth/login', values);
      localStorage.setItem('token', res.data.token);
      setUser(res.data.user); // 同步全局登录态（仅写 localStorage 会导致上下文仍为 null）
      localStorage.setItem('user', JSON.stringify(res.data.user));
      message.success(`欢迎回来，${res.data.user.display_name}`);
      navigate('/dashboard');
    } catch (err) {
      message.error(err.response?.data?.error || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: `linear-gradient(135deg, ${COLORS.bg} 0%, #EDE8E3 100%)`,
    }}>
      <Card style={{
        width: 384, textAlign: 'center',
        borderRadius: 16,
        boxShadow: '0 8px 40px rgba(168,140,120,0.12)',
        border: 'none',
        padding: '40px 32px',
      }} bordered={false}>
        <div style={{
          width: 56, height: 56, borderRadius: 14,
          background: COLORS.primary,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 16px',
          boxShadow: '0 4px 16px rgba(168,140,120,0.25)',
          overflow: 'hidden',
        }}>
          {brand.store_logo
            ? <img src={brand.store_logo} alt="logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            : <HomeOutlined style={{ fontSize: 26, color: '#fff' }} />}
        </div>
        <h1 style={{
          fontSize: 22, marginBottom: 4, color: COLORS.text,
          fontWeight: 600, letterSpacing: 3,
        }}>
          {siteName}
        </h1>
        <p style={{ color: '#888', marginBottom: 32, fontSize: 'var(--font-size-sm)', letterSpacing: 1 }}>
          门店下单管理系统
        </p>
        <Form onFinish={onFinish}>
          <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input prefix={<UserOutlined style={{ color: COLORS.primary }} />} placeholder="用户名" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined style={{ color: COLORS.primary }} />} placeholder="密码" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}
              style={{ height: 44, borderRadius: 10, fontSize: 15, fontWeight: 500 }}>
              登 录
            </Button>
          </Form.Item>
        </Form>
        <p style={{ color: '#bbb', fontSize: 12 }}>默认账号: admin / admin123</p>
      </Card>
    </div>
  );
}
