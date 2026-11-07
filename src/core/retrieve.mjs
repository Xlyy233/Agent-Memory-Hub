// AMH 检索层：默认只返回「已批准 + 当前有效 + 未归档」的记忆；
// 直接读取 vault 内 frontmatter（而非 state/index.json），避免手工修改后索引过期导致误命中。

import path from 'node:path';
import { DEFAULT_SEARCH_POLICY } from './schema.mjs';
import {
  listMemoryFiles,
  loadPolicy,
  readMemory,
} from './store.mjs';

function cmp(a, b) {
  const x = String(a == null ? '' : a);
  const y = String(b == null ? '' : b);
  return x < y ? -1 : x > y ? 1 : 0;
}

// 合并 memory-policy 的默认检索策略；includeStale 时放开 validity
function resolvePolicy(includeStale) {
  const policy = loadPolicy() || {};
  const base = policy.default_search && typeof policy.default_search === 'object'
    ? policy.default_search
    : DEFAULT_SEARCH_POLICY;
  const status = Array.isArray(base.status) && base.status.length
    ? base.status
    : DEFAULT_SEARCH_POLICY.status;
  const archived = typeof base.archived === 'boolean' ? base.archived : false;
  const validity = includeStale
    ? null
    : Array.isArray(base.validity) && base.validity.length
      ? base.validity
      : DEFAULT_SEARCH_POLICY.validity;
  return { status, validity, archived };
}

function loadAll() {
  const out = [];
  for (const file of listMemoryFiles()) {
    let mem;
    try {
      mem = readMemory(file);
    } catch {
      continue;
    }
    const meta = mem.meta || {};
    if (!meta.id) continue;
    out.push({ meta, body: mem.body || '', filePath: mem.filePath, file: mem.vaultPath });
  }
  return out;
}

function makeSnippet(tokens, meta, body) {
  const lines = [String(meta.statement || '')];
  for (const line of String(body || '').split(/\r?\n/)) lines.push(line);
  lines.push(String(meta.scope || ''));
  for (const line of lines) {
    const text = String(line).trim();
    if (!text) continue;
    const lower = text.toLowerCase();
    if (tokens.some((token) => lower.includes(token))) {
      return text.length > 160 ? text.slice(0, 157) + '...' : text;
    }
  }
  const fallback = String(meta.statement || '').trim();
  return fallback.length > 160 ? fallback.slice(0, 157) + '...' : fallback;
}

// 检索：关键词命中 title > tags > scope/statement/body；同级按 updated_at 倒序
export function search({
  project,
  query,
  type,
  tag,
  limit,
  includeStale = false,
} = {}) {
  const policy = resolvePolicy(includeStale);
  const tokens = String(query || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const lim = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 10;
  const projectId = project ? String(project).trim() : '';
  const typeId = type ? String(type).trim() : '';
  const tagId = tag ? String(tag).trim() : '';

  const scored = [];
  for (const entry of loadAll()) {
    const { meta, body, filePath, file } = entry;

    // 默认策略过滤
    if (!policy.status.includes(meta.status)) continue;
    if (policy.validity && !policy.validity.includes(meta.validity)) continue;
    if (policy.archived === false && meta.archived === true) continue;

    // 项目过滤：本项目的记忆 + shared 共享记忆
    if (projectId && meta.project_id !== projectId && meta.project_id !== 'shared') continue;
    if (typeId && meta.type !== typeId) continue;

    const tags = Array.isArray(meta.tags) ? meta.tags.map((t) => String(t)) : [];
    if (tagId && !tags.some((t) => t === tagId)) continue;

    let score = 0;
    let snippet = '';
    if (tokens.length > 0) {
      const title = String(meta.title || '').toLowerCase();
      const statement = String(meta.statement || '').toLowerCase();
      const scope = String(meta.scope || '').toLowerCase();
      const bodyLower = String(body || '').toLowerCase();
      const tagsLower = tags.map((t) => t.toLowerCase());

      let weakest = Infinity;
      let matchedAll = true;
      for (const token of tokens) {
        let tier = 0;
        if (title.includes(token)) tier = 3;
        else if (tagsLower.some((t) => t.includes(token))) tier = 2;
        else if (scope.includes(token) || statement.includes(token) || bodyLower.includes(token)) tier = 1;
        if (!tier) {
          matchedAll = false;
          break;
        }
        if (tier < weakest) weakest = tier;
      }
      if (!matchedAll) continue;
      score = weakest;
      snippet = makeSnippet(tokens, meta, body);
    }

    scored.push({
      id: meta.id,
      project_id: meta.project_id,
      type: meta.type,
      title: meta.title,
      status: meta.status,
      validity: meta.validity,
      archived: meta.archived === true,
      scope: meta.scope,
      tags,
      updated_at: meta.updated_at,
      file,
      filePath,
      score,
      snippet,
    });
  }

  scored.sort(
    (a, b) => (b.score - a.score) || cmp(b.updated_at, a.updated_at) || cmp(a.id, b.id),
  );
  return scored.slice(0, lim);
}

// 按 ID 读取一条正式记忆（返回完整 meta + body）
export function get(id) {
  const target = String(id || '').trim();
  if (!target) return null;
  const files = listMemoryFiles();

  // 先按文件名匹配（写入时文件名为 <id>.md）
  for (const file of files) {
    if (path.basename(file).replace(/\.md$/i, '') !== target) continue;
    const mem = readMemory(file);
    return {
      meta: mem.meta,
      body: mem.body,
      filePath: mem.filePath,
      file: mem.vaultPath,
      errors: mem.errors,
    };
  }

  // 兜底：文件名与 id 不一致时按 frontmatter 查找
  for (const file of files) {
    let mem;
    try {
      mem = readMemory(file);
    } catch {
      continue;
    }
    if (mem.meta && String(mem.meta.id || '') === target) {
      return {
        meta: mem.meta,
        body: mem.body,
        filePath: mem.filePath,
        file: mem.vaultPath,
        errors: mem.errors,
      };
    }
  }
  return null;
}

// 判断某 ID 是否已有正式记忆（审批时防重复）
export function exists(id) {
  return get(id) !== null;
}
