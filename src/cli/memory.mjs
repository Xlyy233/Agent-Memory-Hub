// AMH CLI 入口（Phase 1，零依赖）
// 用法：node src/cli/memory.mjs <命令> [选项]；默认人类可读输出，--json 输出 JSON。
// 写入路径只有一条：candidate add → 人工 review approve → 正式记忆 + 索引重建。

import fs from 'node:fs';
import path from 'node:path';
import {
  RECORD_TYPES,
  SCHEMA_VERSION,
  nowIso,
  validateRecord,
} from '../core/schema.mjs';
import {
  AMH_ROOT,
  appendEvent,
  candidatesDir,
  indexFilePath,
  listCandidates,
  listMemoryFiles,
  loadConfig,
  loadPolicy,
  nextId,
  projectIds,
  readCandidate,
  readMemory,
  vaultRelPath,
  vaultRoot,
  writeCandidate,
  writeMemory,
} from '../core/store.mjs';
import { rebuildIndex, renderMarkdownIndex } from '../core/index.mjs';
import { exists, get, search } from '../core/retrieve.mjs';

// ---------- 参数与输出 ----------

const BOOLEAN_FLAGS = new Set(['json', 'stdin', 'include-stale', 'help']);
const VALUE_FLAGS = new Set(['file', 'project', 'query', 'type', 'tag', 'limit', 'reviewer', 'reason']);

let JSON_OUT = false;

class Exit extends Error {
  constructor(code) {
    super(`exit ${code}`);
    this.code = code;
  }
}

function info(line = '') {
  process.stdout.write(line + '\n');
}

function printJson(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

// 统一的失败出口：JSON 模式输出结构化错误，否则写 stderr
function fail(title, errors = [], extra = {}) {
  if (JSON_OUT) {
    printJson({ ok: false, error: title, errors, ...extra });
  } else {
    process.stderr.write(`错误：${title}\n`);
    for (const item of errors) process.stderr.write(`  - ${item}\n`);
  }
  throw new Exit(1);
}

function parseArgs(argv) {
  const positional = [];
  const flags = Object.create(null);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg === '-h') {
      flags.help = true;
      continue;
    }
    if (arg.startsWith('--')) {
      let key = arg.slice(2);
      let value;
      const eq = key.indexOf('=');
      if (eq !== -1) {
        value = key.slice(eq + 1);
        key = key.slice(0, eq);
      }
      if (!key) throw new Error('参数名不能为空');
      if (BOOLEAN_FLAGS.has(key)) {
        flags[key] = true;
        continue;
      }
      if (!VALUE_FLAGS.has(key)) throw new Error(`未知参数：--${key}`);
      if (value === undefined) {
        if (i + 1 >= argv.length) throw new Error(`参数 --${key} 缺少值`);
        i += 1;
        value = argv[i];
      }
      flags[key] = value;
      continue;
    }
    if (arg.startsWith('-') && arg !== '-') throw new Error(`未知短参数：${arg}`);
    positional.push(arg);
  }
  return { positional, flags };
}

function relPath(filePath) {
  return vaultRelPath(filePath)
    || path.relative(AMH_ROOT, filePath).split(path.sep).join('/');
}

// 读取文本并去掉 BOM（PowerShell 5.1 等工具可能写入 BOM）
function readTextInput(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// ---------- 各命令 ----------

function cmdStatus() {
  const config = loadConfig();
  loadPolicy(); // 策略文件损坏时尽早暴露
  const files = listMemoryFiles();
  const counts = new Map();
  const unknown = [];
  for (const file of files) {
    let projectId = '';
    try {
      projectId = String(readMemory(file).meta?.project_id || '');
    } catch {
      unknown.push(relPath(file));
    }
    if (!projectId) projectId = '（未标注）';
    counts.set(projectId, (counts.get(projectId) || 0) + 1);
  }
  const candidates = listCandidates();
  const projects = projectIds().map((id) => ({
    id,
    name: String(config.projects[id]?.name || ''),
    vault_dir: String(config.projects[id]?.vault_dir || ''),
    memory_count: counts.get(id) || 0,
  }));
  const index = readIndexInfo();

  const data = {
    ok: true,
    root: AMH_ROOT,
    vault_root: vaultRoot(),
    memory_total: files.length,
    candidate_total: candidates.length,
    projects,
    index,
  };
  if (unknown.length) data.unreadable_files = unknown;

  if (JSON_OUT) {
    printJson(data);
    return;
  }
  info('AMH 状态');
  info(`  项目根     ${data.root}`);
  info(`  Vault 根   ${data.vault_root}`);
  info('');
  info(`  正式记忆   ${data.memory_total} 条`);
  info(`  候选       ${data.candidate_total} 条`);
  if (index.exists) {
    info(`  索引       ${index.file}（生成于 ${index.generated_at}，${index.record_count} 条）`);
  } else {
    info('  索引       尚未生成（运行 index rebuild）');
  }
  info('');
  info('项目');
  for (const project of projects) {
    info(`  - ${project.id}（${project.name}）：${project.memory_count} 条  <${project.vault_dir}>`);
  }
  if (unknown.length) {
    info('');
    info('无法读取的文件（供排查）');
    for (const file of unknown) info(`  - ${file}`);
  }
}

function cmdCandidate(sub, rest, flags) {
  if (sub === 'add') return cmdCandidateAdd(flags);
  if (sub === 'list') return cmdCandidateList(flags);
  if (sub === 'show') {
    const id = rest[0];
    if (!id) throw new Error('用法：candidate show <id>');
    const record = readCandidate(id);
    if (!record) fail(`候选不存在：${id}`);
    printJson(record);
    return;
  }
  throw new Error('用法：candidate add|list|show');
}

function cmdCandidateAdd(flags) {
  let raw;
  if (flags.file) {
    const file = path.resolve(String(flags.file));
    try {
      raw = readTextInput(file);
    } catch (err) {
      fail(`无法读取候选文件：${file}`, [err.message]);
    }
  } else if (flags.stdin) {
    raw = fs.readFileSync(0, 'utf8');
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  } else {
    throw new Error('candidate add 需要 --file <json 路径> 或 --stdin');
  }

  let input;
  try {
    input = JSON.parse(raw);
  } catch (err) {
    fail('候选 JSON 解析失败', [err.message]);
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('候选必须是 JSON 对象');
  }

  const projectId = String(input.project_id || flags.project || 'shared').trim();
  const project = projectIds().includes(projectId);
  if (!project) fail(`未注册的项目：${projectId}`, ['请先在 config/projects.json 中登记']);

  const now = nowIso();
  let id;
  if (input.id && String(input.id).trim()) {
    id = String(input.id).trim();
    if (readCandidate(id) || exists(id)) fail(`ID 已被占用：${id}`);
  } else {
    id = nextId('mem', projectId);
  }

  const record = {
    schema_version: SCHEMA_VERSION,
    id,
    project_id: projectId,
    type: input.type,
    title: input.title,
    statement: input.statement,
    status: 'pending',
    evidence_kind: input.evidence_kind || 'none',
    evidence_result: input.evidence_result || 'not-run',
    validity: input.validity || 'current',
    archived: false,
    scope: input.scope,
    tags: Array.isArray(input.tags) ? input.tags : [],
    sources: input.sources,
    created_at: input.created_at || now,
    updated_at: now,
  };
  if (Array.isArray(input.supersedes) && input.supersedes.length) record.supersedes = input.supersedes;
  const body = typeof input.body === 'string' ? input.body : '';

  const check = validateRecord(record, { mode: 'candidate' });
  if (!check.ok) fail('候选校验未通过', check.errors);

  const payload = { ...record };
  if (body.trim()) payload.body = body;
  let candidateFile;
  try {
    candidateFile = writeCandidate(payload);
  } catch (err) {
    fail('写入候选失败', [err.message]);
  }
  appendEvent({ type: 'candidate.add', id, project_id: projectId, file: relPath(candidateFile) });

  if (JSON_OUT) {
    printJson({
      ok: true,
      id,
      project_id: projectId,
      status: 'pending',
      file: relPath(candidateFile),
    });
    return;
  }
  info(`已写入候选：${id}`);
  info(`  项目：${projectId}`);
  info(`  文件：${relPath(candidateFile)}`);
  info(`  下一步：node src/cli/memory.mjs review approve ${id}`);
}

function cmdCandidateList(flags) {
  const projectFilter = flags.project ? String(flags.project).trim() : '';
  const all = listCandidates();
  const items = [];
  for (const candidate of all) {
    if (candidate._parseError) {
      items.push({ id: null, file: relPath(candidate._file), broken: true, error: candidate._parseError });
      continue;
    }
    if (projectFilter && String(candidate.project_id || '') !== projectFilter) continue;
    const promoted = candidate.id ? exists(String(candidate.id)) : false;
    items.push({
      id: candidate.id,
      project_id: candidate.project_id,
      type: candidate.type,
      title: candidate.title,
      status: candidate.status,
      validity: candidate.validity,
      created_at: candidate.created_at,
      file: relPath(candidate._file),
      promoted,
    });
  }

  if (JSON_OUT) {
    printJson({ ok: true, count: items.length, candidates: items });
    return;
  }
  info(`候选：${items.length} 条${projectFilter ? `（项目 ${projectFilter}）` : ''}`);
  for (const item of items) {
    if (item.broken) {
      info(`  ! ${item.file}  [损坏] ${item.error}`);
      continue;
    }
    const mark = item.promoted ? ' → 已晋升' : '';
    info(`  - ${item.id}  [${item.status}]  ${item.project_id}  ${item.type}  ${item.title}${mark}`);
  }
}

function cmdReview(sub, rest, flags) {
  const id = rest[0];
  if (!id) throw new Error(`用法：review ${sub || 'approve|reject'} <id>`);
  if (sub === 'approve') return cmdReviewApprove(id, flags);
  if (sub === 'reject') return cmdReviewReject(id, flags);
  throw new Error('用法：review approve|reject <id>');
}

function sourceSummary(source) {
  if (!source || typeof source !== 'object') return '';
  const kind = String(source.kind || '');
  switch (kind) {
    case 'git':
      return `git: ${source.repo || '?'}@${source.commit || source.snapshot || '?'} ${source.path || '?'}`;
    case 'command':
      return `command: ${source.command || '?'}（cwd ${source.cwd || '?'}，exit ${source.exit_code ?? '?'}，${source.executed_at || '?'}）`;
    case 'file':
      return `file: ${source.path || '?'}（${source.hash || '?'}）`;
    case 'user-statement':
      return `user-statement: ${source.statement || '?'}（${source.confirmed_at || '?'}）`;
    case 'doc':
      return `doc: ${source.locator || '?'}（${source.fetched_at || '?'}）`;
    default:
      return kind;
  }
}

// 候选未自带正文时，按模板生成便于人读的正文
function defaultBody(record) {
  const lines = ['## 主张', '', String(record.statement || '').trim(), '', '## 证据', ''];
  const sources = Array.isArray(record.sources) ? record.sources : [];
  for (const source of sources) lines.push(`- ${sourceSummary(source)}`);
  lines.push('', '## 适用范围', '', String(record.scope || '').trim(), '');
  return lines.join('\n');
}

function cmdReviewApprove(id, flags) {
  const candidate = readCandidate(id);
  if (!candidate) fail(`候选不存在：${id}`);

  const existing = get(id);
  if (existing) {
    fail(`已存在正式记忆：${existing.file}`, ['拒绝重复审批；如需更新请先人工修订（Phase 1 无自动覆盖）']);
  }

  const seed = { ...candidate };
  delete seed.body;
  delete seed._file;
  delete seed._parseError;

  const candidateCheck = validateRecord(seed, { mode: 'candidate' });
  if (!candidateCheck.ok) {
    fail('候选校验未通过，无法晋升', candidateCheck.errors, { id });
  }

  const now = nowIso();
  const reviewer = String(flags.reviewer || 'me').trim() || 'me';
  const record = {
    schema_version: SCHEMA_VERSION,
    id: seed.id,
    project_id: seed.project_id,
    type: seed.type,
    title: seed.title,
    statement: seed.statement,
    status: 'approved',
    evidence_kind: seed.evidence_kind,
    evidence_result: seed.evidence_result,
    validity: seed.validity || 'current',
    archived: seed.archived === true,
    scope: seed.scope,
    tags: Array.isArray(seed.tags) ? seed.tags : [],
    sources: seed.sources,
    created_at: seed.created_at || now,
    updated_at: now,
    reviewed_by: reviewer,
    reviewed_at: now,
  };
  if (Array.isArray(seed.supersedes) && seed.supersedes.length) record.supersedes = seed.supersedes;
  if (seed.last_verified_at) record.last_verified_at = seed.last_verified_at;

  const memoryCheck = validateRecord(record, { mode: 'memory' });
  if (!memoryCheck.ok) {
    fail('晋升校验未通过（正式记忆模式）', memoryCheck.errors, { id });
  }

  const bodyText = typeof candidate.body === 'string' && candidate.body.trim()
    ? candidate.body
    : defaultBody(record);

  let written;
  try {
    written = writeMemory(record.project_id, record, bodyText);
  } catch (err) {
    fail('写入正式记忆失败', [err.message], { id });
  }
  appendEvent({
    type: 'review.approve',
    id,
    project_id: record.project_id,
    reviewer,
    file: written.vaultPath,
  });

  let index;
  try {
    index = rebuildIndex();
    renderMarkdownIndex(index.records);
  } catch (err) {
    fail('索引重建失败（记忆已写入，可重跑 index rebuild）', [err.message], { id, file: written.vaultPath });
  }

  if (JSON_OUT) {
    printJson({
      ok: true,
      id,
      project_id: record.project_id,
      file: written.vaultPath,
      index_records: index.records.length,
      reviewed_by: reviewer,
    });
    return;
  }
  info(`已批准：${id}`);
  info(`  项目：${record.project_id}`);
  info(`  文件：${written.vaultPath}`);
  info(`  索引：${index.records.length} 条记录（已重建）`);
  if (record.validity !== 'current') {
    info(`  注意：validity=${record.validity}，默认检索不会返回该记忆`);
  }
}

function cmdReviewReject(id, flags) {
  const candidate = readCandidate(id);
  if (!candidate) fail(`候选不存在：${id}`);
  const reason = String(flags.reason || '').trim();
  if (!reason) throw new Error('review reject 需要 --reason 说明原因');
  const reviewer = String(flags.reviewer || 'me').trim() || 'me';
  const now = nowIso();
  const updated = {
    ...candidate,
    status: 'rejected',
    rejection_reason: reason,
    reviewed_by: reviewer,
    reviewed_at: now,
    updated_at: now,
  };
  delete updated._file;
  delete updated._parseError;
  writeCandidate(updated);
  appendEvent({
    type: 'review.reject',
    id,
    project_id: updated.project_id,
    reviewer,
    reason,
  });

  if (JSON_OUT) {
    printJson({ ok: true, id, status: 'rejected', reason, reviewed_by: reviewer });
    return;
  }
  info(`已拒绝：${id}`);
  info(`  原因：${reason}`);
}

function cmdSearch(flags) {
  const project = flags.project ? String(flags.project).trim() : '';
  if (project && !projectIds().includes(project)) {
    fail(`未注册的项目：${project}`, ['可用项目见 config/projects.json']);
  }
  let limit;
  if (flags.limit !== undefined) {
    limit = Number(flags.limit);
    if (!Number.isFinite(limit) || limit < 1) {
      fail(`--limit 必须是正整数，实际：${flags.limit}`);
    }
  }
  if (flags.type && !Object.prototype.hasOwnProperty.call(RECORD_TYPES, flags.type)) {
    fail(`未知记忆类型：${flags.type}`, [`可用类型：${Object.keys(RECORD_TYPES).join('/')}`]);
  }

  const results = search({
    project: project || undefined,
    query: flags.query,
    type: flags.type || undefined,
    tag: flags.tag || undefined,
    limit,
    includeStale: flags['include-stale'] === true,
  });

  if (JSON_OUT) {
    printJson({
      ok: true,
      count: results.length,
      project: project || null,
      query: flags.query || null,
      include_stale: flags['include-stale'] === true,
      records: results,
    });
    return;
  }

  const conditions = [];
  if (project) conditions.push(`project=${project}`);
  if (flags.query) conditions.push(`query="${flags.query}"`);
  if (flags.type) conditions.push(`type=${flags.type}`);
  if (flags.tag) conditions.push(`tag=${flags.tag}`);
  if (flags['include-stale']) conditions.push('include-stale');
  info(`检索结果：${results.length} 条${conditions.length ? `（${conditions.join('，')}）` : ''}`);
  if (results.length === 0) {
    info('未找到匹配记忆。');
    return;
  }
  info('');
  results.forEach((record, i) => {
    info(`[${i + 1}] ${record.type}  ${record.id}`);
    info(`    ${record.title}`);
    info(`    项目 ${record.project_id} ｜ 有效性 ${record.validity} ｜ 更新 ${record.updated_at}`);
    if (record.scope) info(`    范围：${record.scope}`);
    if (record.file) info(`    文件：${record.file}`);
    if (record.snippet) info(`    命中：${record.snippet}`);
  });
}

function cmdRead(id, flags) {
  const memory = get(id);
  if (!memory) fail(`未找到记忆：${id}`);
  if (JSON_OUT) {
    printJson({
      ok: true,
      meta: memory.meta,
      body: memory.body,
      file: memory.file,
      filePath: memory.filePath,
      errors: memory.errors || [],
    });
    return;
  }
  const meta = memory.meta || {};
  const typeLabel = RECORD_TYPES[meta.type] ? `${meta.type}（${RECORD_TYPES[meta.type]}）` : meta.type;
  info(`ID：${meta.id}`);
  info(`标题：${meta.title}`);
  info(`项目：${meta.project_id} ｜ 类型：${typeLabel} ｜ 状态：${meta.status} ｜ 有效性：${meta.validity}`);
  info(`证据：${meta.evidence_kind} / ${meta.evidence_result}`);
  info(`范围：${meta.scope}`);
  if (Array.isArray(meta.tags) && meta.tags.length) info(`标签：${meta.tags.join('，')}`);
  info(`更新：${meta.updated_at} ｜ 文件：${memory.file}`);
  if (memory.errors && memory.errors.length) {
    info(`frontmatter 警告：${memory.errors.join('；')}`);
  }
  info('');
  info('---');
  info('');
  info(String(memory.body || '').trim());
}

function cmdIndex(sub) {
  if (sub !== 'rebuild') throw new Error('用法：index rebuild');
  const index = rebuildIndex();
  const markdownPath = renderMarkdownIndex(index.records);
  const data = {
    ok: true,
    generated_at: index.generated_at,
    record_count: index.records.length,
    index: relPath(indexFilePath()),
    markdown: relPath(markdownPath),
  };
  if (JSON_OUT) {
    printJson(data);
    return;
  }
  info(`索引已重建：${data.index}（${data.record_count} 条记录）`);
  info(`Markdown：${data.markdown}`);
}

function cmdValidate() {
  const errors = [];
  let memoryCount = 0;
  let candidateCount = 0;
  let rejectedCount = 0;
  const seenIds = new Map();

  for (const file of listMemoryFiles()) {
    memoryCount += 1;
    let memory;
    try {
      memory = readMemory(file);
    } catch (err) {
      errors.push({ file: relPath(file), errors: [`读取失败：${err.message}`] });
      continue;
    }
    const problems = [...(memory.errors || [])];
    const check = validateRecord(memory.meta, { mode: 'memory' });
    if (!check.ok) problems.push(...check.errors);
    const meta = memory.meta || {};
    const id = String(meta.id || '').trim();
    if (id) {
      if (seenIds.has(id)) {
        problems.push(`ID 重复：${id}（另一处：${seenIds.get(id)}）`);
      } else {
        seenIds.set(id, relPath(file));
      }
    }
    if (meta.project_id && !projectIds().includes(String(meta.project_id))) {
      problems.push(`project_id 未在 config/projects.json 注册：${meta.project_id}`);
    }
    if (problems.length) errors.push({ file: relPath(file), errors: problems });
  }

  for (const candidate of listCandidates()) {
    if (candidate._parseError) {
      errors.push({ file: relPath(candidate._file), errors: [candidate._parseError] });
      continue;
    }
    if (String(candidate.status || '') === 'rejected') {
      rejectedCount += 1; // 已结束审核的候选保留归档，不再要求 pending 形态
      continue;
    }
    candidateCount += 1;
    const check = validateRecord(candidate, { mode: 'candidate' });
    if (!check.ok) errors.push({ file: relPath(candidate._file), errors: check.errors });
  }

  const ok = errors.length === 0;
  if (JSON_OUT) {
    printJson({
      ok,
      checked: { memories: memoryCount, candidates: candidateCount },
      skipped: { rejected: rejectedCount },
      errors,
    });
    if (!ok) throw new Exit(1);
    return;
  }

  info(`校验：正式记忆 ${memoryCount} 条，候选 ${candidateCount} 条${rejectedCount ? `（另跳过 ${rejectedCount} 条已拒绝候选）` : ''}`);
  if (ok) {
    info('✓ 全部通过');
    return;
  }
  info(`✗ 发现 ${errors.length} 处问题`);
  for (const item of errors) {
    info(`  - ${item.file}`);
    for (const message of item.errors) info(`      • ${message}`);
  }
  throw new Exit(1);
}

function readIndexInfo() {
  const file = indexFilePath();
  try {
    let text = fs.readFileSync(file, 'utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const parsed = JSON.parse(text);
    if (parsed && Array.isArray(parsed.records)) {
      return {
        exists: true,
        file: relPath(file),
        generated_at: String(parsed.generated_at || ''),
        record_count: parsed.records.length,
      };
    }
  } catch {
    // 索引缺失或损坏：视为未生成
  }
  return { exists: false, file: relPath(file), generated_at: null, record_count: 0 };
}

function printHelp() {
  info('AMH — Agent Memory Hub Phase 1 CLI');
  info('');
  info('用法：node src/cli/memory.mjs <命令> [选项]');
  info('');
  info('命令：');
  info('  status                                    项目 / 记忆 / 候选 / 索引概况');
  info('  candidate add --file <json>|--stdin       提交候选（校验通过后写入 inbox）');
  info('  candidate list [--project P]              列出候选');
  info('  candidate show <id>                       查看候选原始内容（JSON）');
  info('  review approve <id> [--reviewer X]        人工批准：候选 → 正式记忆 + 重建索引');
  info('  review reject <id> --reason "..."         拒绝候选（保留归档）');
  info('  search --project P [--query Q] [--type T] [--tag G] [--limit N] [--include-stale]');
  info('  read <id>                                 读取一条正式记忆');
  info('  index rebuild                             重建 state/index.json 与 00-索引/INDEX.md');
  info('  validate                                  校验全部正式记忆与候选（出错 exit 1）');
  info('  help                                      显示本帮助');
  info('');
  info('全局选项：');
  info('  --json   机器可读输出（成功与失败均为 JSON）');
  info('');
  info('提示：Agent 不能直接写正式记忆，必须先 candidate add 再由人工 review approve。');
}

// ---------- 入口 ----------

function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  JSON_OUT = flags.json === true;
  if (flags.help) {
    printHelp();
    return;
  }
  const [command, sub, ...rest] = positional;
  if (!command || command === 'help') {
    printHelp();
    return;
  }
  switch (command) {
    case 'status':
      cmdStatus();
      return;
    case 'candidate':
      return cmdCandidate(sub, rest, flags);
    case 'review':
      return cmdReview(sub, rest, flags);
    case 'search':
      return cmdSearch(flags);
    case 'read':
      return cmdRead(sub, flags);
    case 'index':
      return cmdIndex(sub);
    case 'validate':
      return cmdValidate();
    default:
      throw new Error(`未知命令：${command}（运行 help 查看用法）`);
  }
}

try {
  main();
} catch (err) {
  if (err instanceof Exit) {
    process.exitCode = err.code;
  } else {
    const message = err && err.message ? err.message : String(err);
    if (JSON_OUT) printJson({ ok: false, error: message });
    else process.stderr.write(`错误：${message}\n`);
    process.exitCode = 1;
  }
}
