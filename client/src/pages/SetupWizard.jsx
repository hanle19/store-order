import { useState } from 'react';
import { Steps, Input, Button, message, Grid, Space, Upload } from 'antd';
import { ShopOutlined, CheckCircleOutlined, PlusOutlined } from '@ant-design/icons';
import api from '../api';
import { useBrand } from '../context/BrandContext';

const COLOR_SWATCHES = ['#A88C78', '#9C2B2B', '#2F6FB0', '#2E8B57', '#C9821F', '#6B4FA0', '#333333'];

export default function SetupWizard() {
  const { brand, setBrand, colors } = useBrand();
  const { md } = Grid.useBreakpoint();
  const isMobile = !md;

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    industry: '零售批发',
    site_name: brand.site_name || '门店系统',
    store_name: brand.store_name || '我的门店',
    store_address: brand.store_address || '',
    store_phone: brand.store_phone || '',
    store_logo: brand.store_logo || '',
    primary_color: brand.primary_color || '#A88C78',
  });

  const patch = (p) => setForm((prev) => ({ ...prev, ...p }));

  // Logo 上传：antd Upload 直传 /api/upload/image，成功后把返回 url 写入表单
  const [logoFileList, setLogoFileList] = useState(() =>
    form.store_logo ? [{ uid: '-1', name: 'logo', status: 'done', url: form.store_logo }] : []
  );
  const beforeLogoUpload = (file) => {
    const isPng = file.type === 'image/png';
    if (!isPng) {
      message.warning('请上传 PNG 格式图片');
      return Upload.LIST_IGNORE;
    }
    const isLt2M = file.size / 1024 / 1024 < 2;
    if (!isLt2M) {
      message.warning('Logo 图片请小于 2MB');
      return Upload.LIST_IGNORE;
    }
    return true;
  };
  const onLogoChange = ({ fileList }) => {
    const list = fileList.slice(-1);
    setLogoFileList(list);
    const done = list.find((f) => f.status === 'done' && f.response && f.response.url);
    if (done) patch({ store_logo: done.response.url });
    else if (list.length === 0) patch({ store_logo: '' });
  };

  // 每步保存（可续填：关掉后重进，已填内容从服务端回填）
  const persist = async (data) => {
    setSaving(true);
    try {
      await api.put('/config', data);
      setBrand(data);
      return true;
    } catch (e) {
      message.error(e.response?.data?.error || '保存失败');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const next = async () => {
    if (step === 1 && !form.store_name.trim()) {
      message.warning('请填写门店名称');
      return;
    }
    const ok = await persist(form);
    if (ok) setStep((s) => s + 1);
  };

  const prev = () => setStep((s) => s - 1);

  const finish = async () => {
    const ok = await persist({ ...form, setup_completed: '1' });
    if (ok) {
      message.success('初始化完成，欢迎使用！');
      // 重新拉取完整配置，确保全局一致
      setTimeout(() => window.location.reload(), 400);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'var(--color-bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: isMobile ? 16 : 24,
    }}>
      <div style={{
        width: '100%', maxWidth: 560,
        background: 'var(--color-bg-white)', borderRadius: 16,
        boxShadow: '0 12px 48px rgba(0,0,0,0.12)', padding: isMobile ? 20 : 32,
        maxHeight: '92vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: colors.primary, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ShopOutlined style={{ fontSize: 20, color: '#fff' }} />
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text)' }}>欢迎初始化你的门店系统</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>只需几步，把系统改成你自己的门店</div>
          </div>
        </div>

        <Steps
          current={step}
          size="small"
          style={{ margin: '16px 0 24px' }}
          items={[
            { title: '行业' },
            { title: '门店信息' },
            { title: '主题外观' },
            { title: '完成' },
          ]}
        />

        {/* Step 0: 行业类型（自由填写，默认零售批发） */}
        {step === 0 && (
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            <div>
              <div style={labelStyle}>行业类型</div>
              <Input
                value={form.industry}
                maxLength={20}
                onChange={(e) => patch({ industry: e.target.value })}
                placeholder="例如：零售批发"
              />
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', lineHeight: 1.7 }}>
              可填写任意行业，如：零售批发、便利店、母婴店、五金店、文具店等。系统为通用门店管理，行业仅用于标识，不影响功能。
            </div>
          </Space>
        )}

        {/* Step 1: 门店信息 */}
        {step === 1 && (
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            <div>
              <div style={labelStyle}>系统名称（登录页 / 左上角标题）</div>
              <Input value={form.site_name} maxLength={20} onChange={(e) => patch({ site_name: e.target.value })} placeholder="门店系统" />
            </div>
            <div>
              <div style={labelStyle}>门店名称（合同 / 日报 / 订单抬头）<span style={{ color: 'var(--color-error)' }}> *</span></div>
              <Input value={form.store_name} maxLength={20} onChange={(e) => patch({ store_name: e.target.value })} placeholder="我的门店" />
            </div>
            <div>
              <div style={labelStyle}>门店地址</div>
              <Input value={form.store_address} onChange={(e) => patch({ store_address: e.target.value })} placeholder="例如：XX市XX区XX路XX号" />
            </div>
            <div>
              <div style={labelStyle}>门店电话</div>
              <Input value={form.store_phone} onChange={(e) => patch({ store_phone: e.target.value })} placeholder="例如：0351-8888888" />
            </div>
            <div>
              <div style={labelStyle}>门店 Logo（可选，上传 PNG 图片）</div>
              <Upload
                accept=".png,image/png"
                listType="picture-card"
                maxCount={1}
                action="/api/upload/image"
                headers={{ Authorization: `Bearer ${localStorage.getItem('token') || ''}` }}
                fileList={logoFileList}
                beforeUpload={beforeLogoUpload}
                onChange={onLogoChange}
              >
                {logoFileList.length >= 1 ? null : (
                  <div>
                    <PlusOutlined />
                    <div style={{ marginTop: 8 }}>上传 Logo</div>
                  </div>
                )}
              </Upload>
              <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                建议透明背景 PNG，小于 2MB。留空则使用文字标题。
              </div>
            </div>
          </Space>
        )}

        {/* Step 2: 主题外观 */}
        {step === 2 && (
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            <div style={labelStyle}>主题色（实时预览，整套界面随之变色）</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
              {COLOR_SWATCHES.map((c) => (
                <div
                  key={c}
                  onClick={() => patch({ primary_color: c })}
                  style={{
                    width: 40, height: 36, borderRadius: 8, background: c, cursor: 'pointer',
                    border: form.primary_color?.toUpperCase() === c ? '3px solid var(--color-text)' : '2px solid transparent',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
                  }}
                />
              ))}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginLeft: 4 }}>
                <input type="color" value={form.primary_color} onChange={(e) => patch({ primary_color: e.target.value })} style={{ width: 40, height: 36, border: 'none', background: 'none', cursor: 'pointer' }} />
                <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>自定义</span>
              </label>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <Button type="primary">主按钮预览</Button>
              <span style={{ display: 'inline-flex', alignItems: 'center', padding: '4px 12px', borderRadius: 8, background: colors.primaryLight, color: colors.primary, fontSize: 'var(--font-size-sm)' }}>标签预览</span>
            </div>
          </Space>
        )}

        {/* Step 3: 完成 */}
        {step === 3 && (
          <Space direction="vertical" style={{ width: '100%' }} size={14}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--color-success)' }}>
              <CheckCircleOutlined style={{ fontSize: 22 }} />
              <span style={{ fontSize: 16, fontWeight: 600 }}>即将完成</span>
            </div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.8 }}>
              系统名称：<b>{form.site_name || '门店系统'}</b><br />
              门店名称：<b>{form.store_name || '我的门店'}</b><br />
              门店地址：{form.store_address || '（未填写）'}<br />
              门店电话：{form.store_phone || '（未填写）'}<br />
              行业：<b>{form.industry || '零售批发'}</b>
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>完成后这些信息都可随时在「设置 → 品牌设置 / 合同设置」中修改。</div>
          </Space>
        )}

        {/* 底部操作 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 28 }}>
          <Button onClick={prev} disabled={step === 0 || saving}>上一步</Button>
          {step < 3
            ? <Button type="primary" onClick={next} loading={saving}>下一步</Button>
            : <Button type="primary" onClick={finish} loading={saving}>完成初始化</Button>}
        </div>
      </div>
    </div>
  );
}

const labelStyle = {
  fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: 6, fontWeight: 500,
};
