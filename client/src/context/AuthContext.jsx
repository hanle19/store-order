import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../api';

const AuthContext = createContext(null);

function safeParseJSON(txt, fallback) {
  try { return txt ? JSON.parse(txt) : fallback; } catch (e) { return fallback; }
}

export function AuthProvider({ children }) {
  const [user, setUserState] = useState(() => safeParseJSON(localStorage.getItem('user'), null));

  // 同步 user 到 localStorage
  useEffect(() => {
    try {
      if (user) localStorage.setItem('user', JSON.stringify(user));
      else localStorage.removeItem('user');
    } catch (e) { /* ignore */ }
  }, [user]);

  // 启动时验证 token 有效性：token 在但 /auth/me 失效则自动清除（防止复位后 stale token 导致崩溃）
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token || user) return; // 无 token 或已有有效 user 则跳过
    let cancelled = false;
    api.get('/auth/me').then(res => {
      if (cancelled) return;
      if (res.data?.data || res.data?.user || res.data?.id) {
        const u = res.data.data || res.data.user || res.data;
        setUserState(u);
      }
    }).catch(() => {
      // token 无效或过期 → 自动清除，确保回到登录态
      if (cancelled) return;
      console.warn('[Auth] token 验证失败，自动清除');
      try { localStorage.removeItem('token'); } catch(e) {}
    });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setUser = (u) => {
    setUserState(u);
    // 登录态变化后重载品牌配置（含完整配置 + 主题色）
    window.dispatchEvent(new Event('brand:reload'));
  };
  const logout = () => {
    try {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('brand');       // 清品牌缓存（复位后旧值会导致向导不弹）
      localStorage.removeItem('site_name');   // 清旧版品牌名缓存
    } catch (e) { /* ignore */ }
    setUserState(null);
    window.dispatchEvent(new Event('brand:reload'));
  };
  const role = user?.role || null;

  return (
    <AuthContext.Provider value={{ user, role, setUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const c = useContext(AuthContext);
  if (!c) throw new Error('useAuth must be used within AuthProvider');
  return c;
}
