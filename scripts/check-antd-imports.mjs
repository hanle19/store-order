import fs from 'fs';
import path from 'path';

const ANT_COMPONENTS = new Set([
  'Affix','Alert','Anchor','App','AutoComplete','Avatar','BackTop','Badge','Breadcrumb','Button','Calendar','Card','Carousel','Cascader','Checkbox','Col','Collapse','ColorPicker','ConfigProvider','DatePicker','Descriptions','Divider','Drawer','Dropdown','Empty','Flex','FloatButton','Form','Grid','Image','Input','InputNumber','Layout','List','Mentions','Menu','Modal','Notification','Pagination','Popconfirm','Popover','Progress','QRCode','Radio','Rate','Result','Row','Segmented','Select','Skeleton','Slider','Space','Spin','Statistic','Steps','Switch','Table','Tabs','Tag','TimePicker','Timeline','Tooltip','Tour','Transfer','Tree','TreeSelect','Typography','Upload','Watermark'
]);

const OTHER_LIBS = {
  recharts: new Set(['Tooltip','Legend','Line','Area','Bar','Pie','Cell','XAxis','YAxis','CartesianGrid','ResponsiveContainer','ComposedChart','LineChart','BarChart','AreaChart','PieChart','FunnelChart','Funnel','LabelList']),
  '@ant-design/icons': new Set([])
};

function extractImports(code) {
  const imports = new Map();
  const importRegex = /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
  for (const m of code.matchAll(importRegex)) {
    const source = m[2];
    const names = m[1].split(',').map(s => s.trim().split(/\s+as\s+/).pop()).filter(Boolean);
    for (const n of names) imports.set(n, source);
  }
  const defaultRegex = /import\s+([A-Za-z0-9_$]+)\s+from\s+['"]([^'"]+)['"]/g;
  for (const m of code.matchAll(defaultRegex)) {
    imports.set(m[1], m[2]);
  }
  return imports;
}

function extractLocalComponents(code) {
  const locals = new Set();
  const regex1 = /(?:const|function)\s+([A-Z][A-Za-z0-9_$]*)\s*(?:[=\(])/g;
  for (const m of code.matchAll(regex1)) locals.add(m[1]);
  const regex2 = /const\s+\{([^}]+)\}\s*=/g;
  for (const m of code.matchAll(regex2)) {
    m[1].split(',').map(s => s.trim().split(/\s*:\s*/)[0].trim()).filter(n => /^[A-Z]/.test(n)).forEach(n => locals.add(n));
  }
  return locals;
}

function scanFile(fp) {
  const issues = [];
  const code = fs.readFileSync(fp, 'utf-8');
  const imports = extractImports(code);
  const locals = extractLocalComponents(code);
  const usageMatches = code.matchAll(/<\/?([A-Z][A-Za-z0-9_]*)/g);
  const used = new Set();
  for (const m of usageMatches) used.add(m[1]);
  for (const c of used) {
    if (!ANT_COMPONENTS.has(c)) continue;
    if (locals.has(c)) continue;
    const source = imports.get(c);
    if (source) continue; // imported from somewhere (antd, recharts, local, etc.)
    // not imported at all, but name matches an antd component
    issues.push(`${path.relative(process.cwd(), fp)}: 使用 <${c}> 但未导入`);
  }
  return issues;
}

function scanDir(dir) {
  const issues = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.trash') continue;
      issues.push(...scanDir(fp));
    } else if ((e.name.endsWith('.jsx') || e.name.endsWith('.js')) && e.name !== 'check-antd-imports.mjs') {
      issues.push(...scanFile(fp));
    }
  }
  return issues;
}

const issues = scanDir('src');
if (issues.length) {
  console.log('发现以下组件使用但未导入的问题：');
  issues.forEach(i => console.log('  ' + i));
  process.exit(1);
} else {
  console.log('未发现组件导入缺失。');
}
