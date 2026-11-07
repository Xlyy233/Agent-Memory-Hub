// AMH 存储层：配置、路径、正式记忆、候选、事件。
// 约定：正式记忆在 vault 内（唯一权威内容），候选 / 索引只是机器副本；
// 所有写入都走「临时文件 + rename」原子替换，事件日志为单写入者追加。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_SEARCH_POLICY,
  RECORD_TYPES,
  newId,
  nowIso,
  todayYmd,
} from './schema.mjs';
import { composeMemoryFile, parseFrontmatter } from './frontmatter.mjs';

// src/core 上两级即项目根；代码与内部状态（config/state/inbox/logs）都在 vault 外
export const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

// 可用 AMH_ROOT 指向另一套实例（验收脚本据此使用临时目录）
export const AMH_ROOT = process.env.AMH_ROOT
  ? path.resolve(process.env.AMH_ROOT)
  : PROJECT_ROOT;

const CONFIG_PATH = path.join(AMH_ROOT, 'config', 'projects.json');
const POLICY_PATH = path.join(AMH_ROOT, 'config', 'memory-policy.json');
const INDEX_REL = path.join('state', 'index.json');

// 记忆类型 → vault 内子目录（契约里给出的固定映射）
const TYPE_DIRS = Object.freeze({
  architecture: 'architecture',
  decision: 'decisions',
  fact: 'architecture',
  pitfall: 'pitfalls',
  verification: 'verification',
  constraint: 'constraints',
  question: 'questions',
});

// 遍历时跳过的 vault 目录
const EXCLUDED_DIRS = new Set(['_templates', '_meta', '00-索引']);

let cachedConfig = null;
let cachedPolicy = null;

// 读取 UTF-8 文本并去掉可能的 BOM（PowerShell 5.1 等工具会写 BOM）
function readText(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// ---------- 配置 ----------

// 读取 config/projects.json（结果进程内缓存）
export function loadConfig() {
  if (cachedConfig) return cachedConfig;
  let raw;
  try {
    raw = readText(CONFIG_PATH);
  } catch (err) {
    throw new Error(`无法读取项目配置 ${CONFIG_PATH}：${err.message}`);
  }
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch (err) {
    throw new Error(`项目配置不是合法 JSON（${CONFIG_PATH}）：${err.message}`);
  }
  if (!cfg || typeof cfg.vault_root !== 'string' || !cfg.vault_root.trim()) {
    throw new Error(`项目配置缺少 vault_root（${CONFIG_PATH}）`);
  }
  if (!cfg.projects || typeof cfg.projects !== 'object' || Array.isArray(cfg.projects)) {
    throw new Error(`项目配置缺少 projects 对象（${CONFIG_PATH}）`);
  }
  cachedConfig = cfg;
  return cfg;
}

// 读取 config/memory-policy.json；文件缺失时退回 schema 的默认策略
export function loadPolicy() {
  if (cachedPolicy) return cachedPolicy;
  let raw;
  try {
    raw = readText(POLICY_PATH);
  } catch {
    cachedPolicy = { schema_version: 1, default_search: DEFAULT_SEARCH_POLICY };
    return cachedPolicy;
  }
  let policy;
  try {
    policy = JSON.parse(raw);
  } catch (err) {
    throw new Error(`记忆策略不是合法 JSON（${POLICY_PATH}）：${err.message}`);
  }
  cachedPolicy = policy || {};
  return cachedPolicy;
}

// ---------- 路径 ----------

export function vaultRoot() {
  return path.resolve(AMH_ROOT, loadConfig().vault_root);
}

// 已注册项目 ID 列表
export function projectIds() {
  return Object.keys(loadConfig().projects);
}

// 项目在 vault 内的目录；未注册项目直接抛错
export function projectDir(projectId) {
  const id = String(projectId || '').trim();
  if (!id) throw new Error('project_id 不能为空');
  const projects = loadConfig().projects;
  if (!Object.prototype.hasOwnProperty.call(projects, id)) {
    throw new Error(`未注册的项目：${id}（请先在 config/projects.json 中登记）`);
  }
  const vaultDir = String(projects[id]?.vault_dir || '').trim();
  if (!vaultDir) throw new Error(`项目 ${id} 缺少 vault_dir`);
  return path.resolve(vaultRoot(), vaultDir);
}

// 记忆类型对应的 vault 子目录名
export function typeDir(type) {
  if (!Object.prototype.hasOwnProperty.call(TYPE_DIRS, type)) {
    throw new Error(`未知记忆类型：${type || '(空)'}`);
  }
  return TYPE_DIRS[type];
}

// vault 内相对路径（posix 分隔符）；不在 vault 内返回 null
export function vaultRelPath(filePath) {
  const rel = path.relative(vaultRoot(), path.resolve(filePath));
  if (!rel || rel === '..' || rel.startsWith('..' + path.sep)) return null;
  return rel.split(path.sep).join('/');
}

export function indexFilePath() {
  return path.join(AMH_ROOT, INDEX_REL);
}

// ---------- 原子写入 ----------

// 同目录临时文件 + rename，避免半截文件
export function writeAtomic(filePath, content) {
  const target = path.resolve(filePath);
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`,
  );
  fs.writeFileSync(tmp, content, 'utf8');
  try {
    fs.renameSync(tmp, target);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // 清理失败不掩盖原始错误
    }
    throw err;
  }
  return target;
}

// ---------- 正式记忆 ----------

// 遍历 vault 下的 .md 记忆文件（排除模板/元数据/索引目录与 vault 根目录文档）
export function listMemoryFiles() {
  const root = vaultRoot();
  const found = [];
  const walk = (dir, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue; // .obsidian 等隐藏目录
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/\.md$/i.test(entry.name)) continue;
      // vault 根目录的 README / 欢迎 / 设计文档不是记忆
      if (depth === 0) continue;
      found.push(full);
    }
  };
  walk(root, 0);
  return found;
}

// 读取单条记忆文件：{meta, body, filePath, vaultPath, errors}
export function readMemory(filePath) {
  const abs = path.isAbsolute(String(filePath))
    ? path.resolve(String(filePath))
    : path.resolve(vaultRoot(), String(filePath));
  const text = readText(abs);
  const parsed = parseFrontmatter(text);
  return {
    meta: parsed.meta,
    body: parsed.body,
    filePath: abs,
    vaultPath: vaultRelPath(abs),
    errors: parsed.errors,
  };
}

// 写入正式记忆：vault/<project vault_dir>/<type 子目录>/<id>.md
export function writeMemory(projectId, meta, body = '') {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    throw new Error('meta 必须是对象');
  }
  const dir = projectDir(projectId); // 校验项目已注册
  const id = assertSafeId(meta.id, '记忆 ID');
  const type = String(meta.type || '');
  if (!Object.prototype.hasOwnProperty.call(RECORD_TYPES, type)) {
    throw new Error(`未知记忆类型：${type || '(空)'}`);
  }
  if (meta.project_id && String(meta.project_id) !== String(projectId)) {
    throw new Error(`meta.project_id（${meta.project_id}）与写入项目（${projectId}）不一致`);
  }
  const target = path.join(dir, TYPE_DIRS[type], `${id}.md`);
  writeAtomic(target, composeMemoryFile(meta, body));
  return { filePath: target, vaultPath: vaultRelPath(target) };
}

// ---------- 候选 ----------

export function candidatesDir() {
  return path.join(AMH_ROOT, 'inbox', 'candidates');
}

function candidatePath(id) {
  return path.join(candidatesDir(), `${assertSafeId(id, '候选 ID')}.json`);
}

// 列出全部候选；损坏文件以 _parseError 返回，便于校验命令报告
export function listCandidates() {
  const dir = candidatesDir();
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => /\.json$/i.test(n));
  } catch {
    return [];
  }
  names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const out = [];
  for (const name of names) {
    const file = path.join(dir, name);
    try {
      const record = JSON.parse(readText(file));
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        out.push({ _file: file, _parseError: '候选文件内容不是 JSON 对象' });
        continue;
      }
      out.push({ ...record, _file: file });
    } catch (err) {
      out.push({ _file: file, _parseError: `候选 JSON 解析失败：${err.message}` });
    }
  }
  return out;
}

// 读取单个候选；不存在返回 null
export function readCandidate(id) {
  const file = candidatePath(id);
  let raw;
  try {
    raw = readText(file);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`候选 ${id} 的 JSON 解析失败：${err.message}`);
  }
}

// 写入候选（原子替换）；以下划线开头的内部字段不落盘
export function writeCandidate(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('候选必须是对象');
  }
  assertSafeId(obj.id, '候选 ID');
  const clean = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith('_')) continue;
    clean[key] = value;
  }
  const file = candidatePath(clean.id);
  writeAtomic(file, JSON.stringify(clean, null, 2) + '\n');
  return file;
}

// ---------- ID ----------

// 基于当天已用序号生成新 ID（记忆与候选共用一套序号空间）
export function nextId(prefix, projectId) {
  const today = todayYmd();
  const project = sanitizeProject(projectId);
  const esc = String(prefix).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${esc}-(\\d{8})-(.+)-(\\d{4})$`);

  const existing = new Set();
  const collect = (id) => {
    const value = String(id || '');
    if (!value) return;
    existing.add(value);
  };
  for (const file of listMemoryFiles()) collect(path.basename(file).replace(/\.md$/i, ''));
  for (const cand of listCandidates()) collect(cand.id);

  let maxSeq = 0;
  for (const id of existing) {
    const m = re.exec(id);
    if (!m) continue;
    if (m[1] !== today || m[2] !== project) continue;
    const seq = Number(m[3]);
    if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
  }

  for (let i = 0; i < 10000; i += 1) {
    maxSeq += 1;
    const id = newId(prefix, projectId, maxSeq);
    if (!existing.has(id) && !fs.existsSync(path.join(candidatesDir(), `${id}.json`))) {
      return id;
    }
  }
  throw new Error('无法分配新的记忆 ID（序号空间耗尽）');
}

function sanitizeProject(projectId) {
  return (
    String(projectId || 'shared')
      .replace(/[^A-Za-z0-9_-]/g, '')
      .slice(0, 16) || 'shared'
  );
}

// ---------- 事件 ----------

// 追加一行事件到 logs/events.jsonl（单写入者，append 为原子追加）
export function appendEvent(event = {}) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new Error('event 必须是对象');
  }
  const dir = path.join(AMH_ROOT, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  const record = { at: nowIso(), ...event };
  fs.appendFileSync(path.join(dir, 'events.jsonl'), JSON.stringify(record) + '\n', 'utf8');
  return record;
}

// ---------- 内部工具 ----------

function assertSafeId(id, label = 'ID') {
  const value = String(id == null ? '' : id);
  if (!value || value === '.' || value === '..' || !/^[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error(`非法${label}：${JSON.stringify(id)}（只允许字母、数字、_ . -）`);
  }
  return value;
}
