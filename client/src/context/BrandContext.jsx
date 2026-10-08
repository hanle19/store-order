import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { ConfigProvider, theme as antdTheme } from 'antd';
import api from '../api';
import { useTheme } from './ThemeContext';

const BrandContext = createContext(null);

// 中性默认值：复位/首次部署后、向导未跑之前使用，确保「晚安家居」字样彻底消失
export const NEUTRAL_BRAND = {
  site_name: '门店系统',
  store_name: '我的门店',
  store_address: '',
  store_phone: '',
  store_logo: '',
  primary_color: '#A88C78',
  industry: 'furniture',
  setup_completed: '0',
};

// 由基础色生成派生色（hover / light / fade），保持与主色协调
function deriveColors(hex) {
  const c = hex && /^#([0-9a-f]{6})$/i.test(hex) ? hex : '#A88C78';
  const r = parseInt(c.slice(1, 3), 16);
  const g = parseInt(c.slice(3, 5), 16);
  const b = parseInt(c.slice(5, 7), 16);
  const darken = (f) =>
    '#' + [r, g, b].map((v) => Math.max(0, Math.round(v * f)).toString(16).padStart(2, '0')).join('');
  return {
    primary: c,
    primaryHover: darken(0.88),
    primaryLight: `rgba(${r}, ${g}, ${b}, 0.08)`,
    primaryFade: `rgba(${r}, ${g}, ${b}, 0.04)`,
  };
}

function applyThemeVars(colors) {
  const root = document.documentElement;
  root.style.setProperty('--color-primary', colors.primary);
  root.style.setProperty('--color-primary-hover', colors.primaryHover);
  root.style.setProperty('--color-primary-light', colors.primaryLight);
  root.style.setProperty('--color-primary-fade', colors.primaryFade);
}

export function BrandProvider({ children }) {
  const [brand, setBrandState] = useState(() => {
    try {
      const cached = localStorage.getItem('brand');
      return cached ? JSON.parse(cached) : NEUTRAL_BRAND;
    } catch {
      return NEUTRAL_BRAND;
    }
  });
  // loaded：标记已完成至少一次配置拉取，避免向导在 setup_completed 就绪前误判/闪烁
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    try {
      const token = localStorage.getItem('token');
      const url = token ? '/config' : '/config/public';
      const res = await api.get(url);
      const data = res.data || {};
      setBrandState((prev) => {
        const next = { ...prev, ...data };
        try { localStorage.setItem('brand', JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
      setLoaded(true);
    } catch {
      /* 忽略，保留 neutral / 缓存，但仍标记已尝试加载避免永久阻塞向导 */
      setLoaded(true);
    }
  };

  // 首次加载（无 token 走 public 拿 site_name；有 token 拿完整配置）
  useEffect(() => { load(); }, []);

  // 登录态变化后由 AuthContext 派发 brand:reload，重载完整配置
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('brand:reload', handler);
    return () => window.removeEventListener('brand:reload', handler);
  }, []);

  const { isDark } = useTheme();
  const colors = useMemo(() => deriveColors(brand.primary_color), [brand.primary_color]);
  useEffect(() => { applyThemeVars(colors); }, [colors]);

  // 乐观更新（向导分步保存后即时反映到界面，再等待服务端落库）
  const setBrand = (patch) => {
    setBrandState((prev) => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem('brand', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const value = { brand, setBrand, colors, reload: load, loaded };

  // ⚡ 性能：记忆品牌主题对象。否则每次 BrandProvider 重渲染都会重建 theme 对象，
  // 触发 antd v5 该层（嵌套 ConfigProvider）重新计算并注入样式。
  const brandTheme = useMemo(
    () => ({ algorithm: isDark ? antdTheme.darkAlgorithm : undefined, token: { colorPrimary: colors.primary } }),
    [isDark, colors.primary]
  );

  return (
    <BrandContext.Provider value={value}>
      <ConfigProvider theme={brandTheme}>
        {children}
      </ConfigProvider>
    </BrandContext.Provider>
  );
}

const DEFAULT_WAREHOUSES = ['正大物流', '广东物流', '其它物流'];

// 解析系统配置中的库房列表（JSON 字符串数组），解析失败或未配置时回退默认三项
export function useWarehouses() {
  const { brand } = useBrand();
  return useMemo(() => {
    try {
      const arr = JSON.parse(brand.warehouses || '[]');
      if (Array.isArray(arr) && arr.length) {
        return arr.map(x => String(x).trim()).filter(Boolean);
      }
    } catch { /* 解析失败回退默认 */ }
    return DEFAULT_WAREHOUSES;
  }, [brand.warehouses]);
}

export { DEFAULT_WAREHOUSES };

export function useBrand() {
  const c = useContext(BrandContext);
  if (!c) throw new Error('useBrand must be used within BrandProvider');
  return c;
}
