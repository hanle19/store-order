const fs = require('fs');
const path = require('path');

const files = process.argv.slice(2);
const RESERVED = new Set(['STYLE', 'STYLE2', 'Style', 'Page', 'App', 'React', 'Component', 'Fragment', 'useState', 'useEffect', 'useRef', 'useMemo', 'useCallback', 'useReducer', 'useContext', 'forwardRef', 'memo', 'Children', 'createContext', 'Math', 'JSON', 'Date', 'Array', 'Object', 'String', 'Number', 'Boolean', 'Console', 'Promise', 'Set', 'Map', 'RegExp']);

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  // 收集 antd import 的标识符
  const antdImports = new Set();
  const re = /import\s*\{([^}]*)\}\s*from\s*['"]antd['"]/g;
  let m;
  while ((m = re.exec(src))) {
    m[1].split(',').forEach(s => {
      const name = s.trim().split(/\s+as\s+/)[0].trim();
      if (name) antdImports.add(name);
    });
  }
  // 收集其他具名 import（非 react / 非 antd），这些可能是本地/第三方组件
  const otherImports = new Set();
  const re2 = /import\s*\{([^}]*)\}\s*from\s*['"](?!antd|react)[^'"]+['"]/g;
  while ((m = re2.exec(src))) {
    m[1].split(',').forEach(s => {
      const name = s.trim().split(/\s+as\s+/)[0].trim();
      if (name && /^[A-Z]/.test(name)) otherImports.add(name);
    });
  }
  // 收集本地函数/组件定义
  const localDefs = new Set();
  const re3 = /(?:function\s+([A-Za-z0-9_]+)|const\s+([A-Za-z0-9_]+)\s*=)/g;
  while ((m = re3.exec(src))) {
    const n = m[1] || m[2];
    if (n) localDefs.add(n);
  }
  // 提取所有大写开头的 JSX 标签
  const used = new Set();
  const re4 = /<\s*([A-Z][A-Za-z0-9_]*)/g;
  while ((m = re4.exec(src))) used.add(m[1]);
  // 差异：用了但是 ant d 未导入，且不是本地定义/其他 import/保留字
  const missing = [...used].filter(name =>
    !antdImports.has(name) &&
    !otherImports.has(name) &&
    !localDefs.has(name) &&
    !RESERVED.has(name)
  );
  console.log(`\n=== ${path.basename(f)} ===`);
  console.log('  antd imported :', [...antdImports].join(', ') || '(none)');
  console.log('  JSX caps used :', [...used].join(', ') || '(none)');
  console.log('  >> POTENTIAL MISSING (used but not imported from antd):', missing.join(', ') || 'NONE ✅');
}
