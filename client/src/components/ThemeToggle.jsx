import { Segmented } from 'antd';
import { SunOutlined, MoonOutlined, DesktopOutlined } from '@ant-design/icons';
import { useTheme } from '../context/ThemeContext';

// 亮色 / 暗色 / 跟随系统 三态切换
export default function ThemeToggle() {
  const { mode, setMode } = useTheme();
  return (
    <Segmented
      size="small"
      value={mode}
      onChange={(v) => setMode(v)}
      className="header-theme-segmented"
      options={[
        { value: 'light', icon: <SunOutlined /> },
        { value: 'dark', icon: <MoonOutlined /> },
        { value: 'system', icon: <DesktopOutlined /> },
      ]}
    />
  );
}
