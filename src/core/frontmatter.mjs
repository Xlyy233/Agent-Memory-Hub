// AMH Frontmatter 解析与生成（零依赖 YAML 子集）
// 只支持本契约实际使用的结构：
//   顶层 key: 标量
//   顶层 key: 后跟列表（列表项为标量或“单层对象”）
// 不支持任意嵌套 YAML——模板与文档只允许使用本子集。

const SCALAR_RE = /^([A-Za-z0-9_-]+):(?:\s+(.*))?$/;

function splitKV(content) {
  const m = SCALAR_RE.exec(content.trim());
  if (!m) return null;
  return [m[1], (m[2] || '').trim()];
}

function parseScalar(raw) {
  const v = raw.trim();
  if (v === '') return '';
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v.startsWith('"') && v.endsWith('"')) {
    try {
      return JSON.parse(v);
    } catch {
      return v.slice(1, -1);
    }
  }
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
  return v;
}

export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta: {}, body: text, errors: ['缺少 frontmatter 分隔符'] };

  const lines = m[1].split(/\r?\n/);
  const meta = {};
  const errors = [];
  let current = null; // { key, items, lastObj }

  for (const line of lines) {
    if (!line.trim()) continue;
    const indent = line.match(/^(\s*)/)[1].length;
    const content = line.slice(indent).trimStart();

    if (indent === 0) {
      const kv = splitKV(content);
      if (!kv) {
        errors.push(`无法解析顶层行: ${content}`);
        continue;
      }
      const [key, val] = kv;
      if (val === '') {
        current = { key, items: [], lastObj: null };
        meta[key] = current.items;
      } else {
        meta[key] = parseScalar(val);
        current = null;
      }
      continue;
    }

    if (!current) {
      errors.push(`孤立缩进行: ${line}`);
      continue;
    }

    if (/^-\s+/.test(content)) {
      const itemContent = content.replace(/^-\s+/, '').trim();
      const kv = splitKV(itemContent);
      if (kv) {
        const obj = { [kv[0]]: parseScalar(kv[1]) };
        current.items.push(obj);
        current.lastObj = obj;
      } else {
        current.items.push(parseScalar(itemContent));
        current.lastObj = null;
      }
      continue;
    }

    // 列表项对象的后续字段
    const kv = splitKV(content);
    if (kv && current.lastObj) {
      current.lastObj[kv[0]] = parseScalar(kv[1]);
      continue;
    }
    errors.push(`无法解析列表内行: ${content}`);
  }

  return { meta, body: text.slice(m[0].length), errors };
}

function needsQuote(s) {
  if (s === '') return true;
  if (/^[\s]|[\s]$/.test(s)) return true;
  return /[:#\n\r\t"']|^-|^\d+[.:]/.test(s) || s === 'true' || s === 'false' || s === 'null';
}

function scalarToYaml(v) {
  if (typeof v === 'string') return needsQuote(v) ? JSON.stringify(v) : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v === null || v === undefined) return 'null';
  return JSON.stringify(v);
}

export function stringifyFrontmatter(meta) {
  const out = ['---'];
  const order = [
    'id', 'schema_version', 'project_id', 'type', 'title', 'status',
    'evidence_kind', 'evidence_result', 'validity', 'archived',
    'scope', 'tags', 'sources', 'supersedes',
    'created_at', 'updated_at', 'last_verified_at', 'reviewed_by', 'reviewed_at',
  ];
  const keys = [
    ...order.filter((k) => Object.prototype.hasOwnProperty.call(meta, k)),
    ...Object.keys(meta).filter((k) => !order.includes(k)),
  ];

  for (const key of keys) {
    const v = meta[key];
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) {
        out.push(`${key}: []`);
        continue;
      }
      out.push(`${key}:`);
      for (const item of v) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const entries = Object.entries(item);
          if (entries.length === 0) {
            out.push('  - {}');
            continue;
          }
          entries.forEach(([k, val], idx) => {
            out.push(`  ${idx === 0 ? '-' : ' '} ${k}: ${scalarToYaml(val)}`);
          });
        } else {
          out.push(`  - ${scalarToYaml(item)}`);
        }
      }
    } else if (v && typeof v === 'object') {
      out.push(`${key}: ${JSON.stringify(v)}`);
    } else {
      out.push(`${key}: ${scalarToYaml(v)}`);
    }
  }
  out.push('---');
  return out.join('\n');
}

export function composeMemoryFile(meta, body = '') {
  return `${stringifyFrontmatter(meta)}\n\n${body.trim()}\n`;
}
