import { theme as antdTheme } from 'antd';

// 亮色设计令牌（与 index.css :root 保持一致）
const baseToken = {
  colorPrimary: '#A88C78',
  colorPrimaryHover: '#967A66',
  colorSuccess: '#389E0D',
  colorWarning: '#D48806',
  colorError: '#CF1322',
  colorInfo: '#1677FF',
  colorTextBase: '#333333',
  colorText: '#333333',
  colorTextSecondary: '#666666',
  colorTextTertiary: '#999999',
  colorBgBase: '#FFFFFF',
  colorBgLayout: '#F5F3F0',
  colorBgContainer: '#FFFFFF',
  colorBorder: '#E8E5E0',
  colorBorderSecondary: '#F0EDE9',
  borderRadius: 6,
  borderRadiusLG: 8,
  fontSize: 15,
  fontSizeHeading1: 24,
  fontSizeHeading2: 20,
  fontSizeHeading3: 18,
  fontSizeHeading4: 16,
  fontSizeLG: 16,
  fontSizeSM: 13,
  lineHeight: 1.6,
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
  boxShadowSecondary: '0 2px 8px rgba(0,0,0,0.05)',
  padding: 16,
  paddingLG: 24,
  paddingSM: 12,
  paddingXS: 8,
  margin: 16,
  marginLG: 24,
  marginSM: 12,
  controlHeight: 44,
  controlHeightLG: 48,
  controlHeightSM: 32,
};

const baseComponents = {
  Card: { borderRadiusLG: 8, paddingLG: 24, padding: 16 },
  Menu: {
    itemBg: 'transparent',
    itemSelectedBg: 'rgba(168, 140, 120, 0.08)',
    itemSelectedColor: 'var(--color-primary)',
    itemColor: '#333333',
    itemHoverBg: 'rgba(168, 140, 120, 0.04)',
    itemBorderRadius: 8,
  },
  Table: {
    headerBg: '#F5F3F0',
    headerColor: '#666666',
    borderColor: '#F0EDE9',
    rowHoverBg: 'rgba(168, 140, 120, 0.04)',
    cellPaddingBlock: 14,
    cellPaddingInline: 16,
  },
  Button: { borderRadius: 6, controlHeight: 44, controlHeightLG: 48, controlHeightSM: 32, paddingInline: 16, paddingInlineSM: 12 },
  Select: { borderRadius: 6, controlHeight: 44 },
  Input: { borderRadius: 6, controlHeight: 44 },
  InputNumber: { borderRadius: 6, controlHeight: 44 },
  DatePicker: { borderRadius: 6, controlHeight: 44 },
  Modal: { borderRadiusLG: 12, titleFontSize: 18 },
  Tag: { borderRadiusSM: 6 },
  Progress: { defaultColor: 'var(--color-primary)' },
  Steps: { fontSize: 13 },
  Form: { itemMarginBottom: 20 },
};

// 根据是否暗色生成 antd 主题对象
export function createTheme(isDark) {
  if (!isDark) {
    return { token: baseToken, components: baseComponents };
  }
  // 暗色：darkAlgorithm 自动派生 token，显式锁定背景/文字/边框 seed，避免个别 antd 组件漂移
  return {
    algorithm: [antdTheme.darkAlgorithm],
    token: {
      ...baseToken,
      colorBgBase: '#141414',
      colorBgContainer: '#1F1F1F',
      colorBgLayout: '#141414',
      colorTextBase: '#E8E8E8',
      colorText: '#E8E8E8',
      colorTextSecondary: '#B0B0B0',
      colorTextTertiary: '#8C8C8C',
      colorBorder: '#303030',
      colorBorderSecondary: '#2A2A2A',
    },
    components: {
      ...baseComponents,
      Menu: {
        itemBg: 'transparent',
        itemSelectedBg: 'rgba(168, 140, 120, 0.22)',
        itemSelectedColor: 'var(--color-primary)',
        itemColor: 'rgba(255, 255, 255, 0.65)',
        itemHoverBg: 'rgba(255, 255, 255, 0.08)',
        itemBorderRadius: 8,
      },
      Table: {
        headerBg: '#1F1F1F',
        headerColor: 'rgba(255, 255, 255, 0.85)',
        borderColor: '#303030',
        rowHoverBg: 'rgba(255, 255, 255, 0.04)',
        cellPaddingBlock: 14,
        cellPaddingInline: 16,
      },
    },
  };
}
