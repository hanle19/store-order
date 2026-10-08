import { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { createTheme } from '../theme';

const ThemeContext = createContext(null);
const STORAGE_KEY = 'theme-mode'; // 'light' | 'dark' | 'system'

function getSystemDark() {
  return typeof window !== 'undefined' && window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(() => localStorage.getItem(STORAGE_KEY) || 'system');
  const [systemDark, setSystemDark] = useState(getSystemDark);

  // 监听系统主题变化（仅 system 模式需要）
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => setSystemDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const isDark = mode === 'dark' || (mode === 'system' && systemDark);

  // 同步到 <html data-theme>，驱动 index.css 的变量覆盖
  useEffect(() => {
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
  }, [isDark]);

  // ⚡ 性能：记忆主题对象。antd v5 依据 theme 对象引用决定是否重算 CSS-in-JS，
  // 每次渲染都重建会触发全站样式重算（哈希+重新注入），祖先任意重渲染都会卡顿。
  // 仅在 isDark 变化时重算，平时保持引用稳定。
  const antdTheme = useMemo(() => createTheme(isDark), [isDark]);

  const setMode = (m) => {
    localStorage.setItem(STORAGE_KEY, m);
    setModeState(m);
  };

  return (
    <ThemeContext.Provider value={{ mode, isDark, setMode }}>
      <ConfigProvider locale={zhCN} theme={antdTheme}>
        {children}
      </ConfigProvider>
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
