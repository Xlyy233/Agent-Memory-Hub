// AMH 索引层：从正式记忆生成机器索引与人类可读索引。
// state/index.json 与 00-索引/INDEX.md 都是派生副本，可随时由 vault 重建。

import fs from 'node:fs';
import path from 'node:path';
import { nowIso, RECORD_TYPES } from './schema.mjs';
import {
  indexFilePath,
  listMemoryFiles,
  loadConfig,
  readMemory,
  vaultRelPath,
  vaultRoot,
  writeAtomic,
} from './store.mjs';

function cmp(a, b) {
  const x = String(a == null ? '' : a);
  const y = String(b == null ? '' : b);
  return x < y ? -1 : x > y ? 1 : 0;
}

// 根据文件所在目录推断所属项目（优先使用 frontmatter 的 project_id）
function projectFromPath(filePath) {
  const rel = vaultRelPath(filePath);
  if (!rel) return '';
  let best = '';
  let bestLen = -1;
  const projects = loadConfig().projects || {};
  for (const [id, project] of Object.entries(projects)) {
    const dir = String(project?.vault_dir || '')
      .replace(/\\/g, '/')
      .replace(/^\/+|\/+$/g, '');
    if (!dir) continue;
    if ((rel === dir || rel.startsWith(dir + '/')) && dir.length > bestLen) {
      best = id;
      bestLen = dir.length;
    }
  }
  return best;
}

// 汇总 vault 内全部记忆的索引项
function collectRecords() {
  const records = [];
  for (const file of listMemoryFiles()) {
    let mem;
    try {
      mem = readMemory(file);
    } catch {
      continue; // 读不了的文件由 validate 报告，索引只收可用记录
    }
    const meta = mem.meta || {};
    const id = String(meta.id || '').trim();
    if (!id) continue;
    records.push({
      id,
      project_id: String(meta.project_id || projectFromPath(file) || ''),
      type: String(meta.type || ''),
      title: String(meta.title || ''),
      status: String(meta.status || ''),
      validity: String(meta.validity || ''),
      archived: meta.archived === true,
      scope: String(meta.scope || ''),
      tags: Array.isArray(meta.tags) ? meta.tags.map((t) => String(t)) : [],
      file: mem.vaultPath || '',
      updated_at: String(meta.updated_at || ''),
    });
  }
  records.sort((a, b) => cmp(a.project_id, b.project_id) || cmp(a.id, b.id));
  return records;
}

// 重建 state/index.json；返回 {generated_at, records}
export function rebuildIndex() {
  const index = { generated_at: nowIso(), records: collectRecords() };
  writeAtomic(indexFilePath(), JSON.stringify(index, null, 2) + '\n');
  return index;
}

// 读取索引；不存在或损坏时自动重建
export function loadIndex() {
  const file = indexFilePath();
  try {
    let text = fs.readFileSync(file, 'utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // 容忍 BOM
    const parsed = JSON.parse(text);
    if (parsed && Array.isArray(parsed.records)) return parsed;
  } catch {
    // 落到重建分支
  }
  return rebuildIndex();
}

// 单元表格转义
function cell(value) {
  return String(value == null ? '' : value)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim();
}

// INDEX.md 位于 00-索引 下，链接需要向上一级
function fileLink(record) {
  const rel = String(record.file || '');
  const name = rel.split('/').pop() || record.id;
  if (!rel) return cell(name);
  return `[${name}](../${rel.replace(/ /g, '%20')})`;
}

// 生成 vault/00-索引/INDEX.md（传入 records 可复用已有索引结果）
export function renderMarkdownIndex(records) {
  const list = Array.isArray(records) ? records : collectRecords();
  const generated = nowIso();
  const lines = [
    '# AMH 记忆索引',
    '',
    '> 自动生成，请勿手工编辑。内容以 vault 内正式记忆的 frontmatter 为准，',
    '> 本文件与 `state/index.json` 均可用 `node src/cli/memory.mjs index rebuild` 重建。',
    `> 生成时间：${generated} ｜ 记录数：${list.length}`,
    '',
    '| ID | 项目 | 类型 | 标题 | 状态 | 有效性 | 范围 | 文件 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const record of list) {
    const label = RECORD_TYPES[record.type];
    const typeText = label ? `${label}（${record.type}）` : record.type;
    const statusText = record.archived ? `${record.status} / archived` : record.status;
    lines.push(
      `| ${cell(record.id)} | ${cell(record.project_id)} | ${cell(typeText)} | ${cell(record.title)} | `
        + `${cell(statusText)} | ${cell(record.validity)} | ${cell(record.scope)} | ${fileLink(record)} |`,
    );
  }
  lines.push('');
  const target = path.join(vaultRoot(), '00-索引', 'INDEX.md');
  writeAtomic(target, lines.join('\n'));
  return target;
}
