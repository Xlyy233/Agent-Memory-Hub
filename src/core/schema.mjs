// AMH 数据契约（Phase 1 冻结版）
// 零依赖：仅使用 Node.js 内置能力。所有模块以本文件为唯一事实源。
// 四维状态模型（对齐 2026-11-07 Codex 回应）：
//   证据与验证结果 evidence_kind + evidence_result
//   审核状态       status  (pending | approved | rejected)
//   有效性         validity (current | stale | superseded | revoked)
//   归档           archived (true | false)

export const SCHEMA_VERSION = 1;

export const LIMITS = Object.freeze({
  titleMax: 120,
  statementMax: 2000,
  scopeMax: 500,
  tagsMax: 20,
  sourcesMax: 10,
});

// 记忆类型（决定“证据需要支持什么”）
export const RECORD_TYPES = Object.freeze({
  architecture: '架构事实',
  decision: '架构决策',
  fact: '项目事实',
  pitfall: '故障经验',
  verification: '验证方法',
  constraint: '兼容约束',
  question: '待确认问题',
});

export const REVIEW_STATUS = Object.freeze(['pending', 'approved', 'rejected']);
export const VALIDITY = Object.freeze(['current', 'stale', 'superseded', 'revoked']);
export const EVIDENCE_KINDS = Object.freeze([
  'user-confirmed',
  'static-check',
  'runtime-verified',
  'none',
]);
export const EVIDENCE_RESULTS = Object.freeze(['passed', 'failed', 'not-run']);

export const SOURCE_KINDS = Object.freeze([
  'git',
  'command',
  'file',
  'user-statement',
  'doc',
]);

// 每种来源的最低核验信息（字段缺失即判定不可入库）
export const SOURCE_REQUIRED_FIELDS = Object.freeze({
  git: ['repo', 'path', 'hash'],
  command: ['command', 'cwd', 'executed_at', 'exit_code'],
  file: ['path', 'hash'],
  'user-statement': ['statement', 'confirmed_at'],
  doc: ['locator', 'fetched_at'],
});

// git 来源允许用 commit 或 snapshot 之一替代，至少一个
export const SOURCE_ALTERNATIVES = Object.freeze({
  git: [['commit', 'snapshot']],
});

export const DEFAULT_SEARCH_POLICY = Object.freeze({
  status: Object.freeze(['approved']),
  validity: Object.freeze(['current']),
  archived: false,
});

export function nowIso() {
  return new Date().toISOString();
}

export function todayYmd(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

export function newId(prefix, projectId, seq = 1) {
  const p = String(projectId || 'shared')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 16) || 'shared';
  return `${prefix}-${todayYmd()}-${p}-${String(seq).padStart(4, '0')}`;
}

function asString(v) {
  return typeof v === 'string' ? v : '';
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isIsoDate(v) {
  if (!isNonEmptyString(v)) return false;
  const t = Date.parse(v);
  return Number.isFinite(t);
}

// 校验单条记忆（正式）或候选记录。
// mode='candidate'：只允许 pending；mode='memory'：只允许 approved。
export function validateRecord(record, { mode = 'candidate' } = {}) {
  const errors = [];
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { ok: false, errors: ['记录必须是对象'] };
  }

  const need = (cond, msg) => {
    if (!cond) errors.push(msg);
  };

  need(record.schema_version === SCHEMA_VERSION, `schema_version 必须为 ${SCHEMA_VERSION}`);
  need(isNonEmptyString(record.id), 'id 不能为空');
  need(isNonEmptyString(record.project_id), 'project_id 不能为空');
  need(
    Object.prototype.hasOwnProperty.call(RECORD_TYPES, record.type),
    `type 必须是 ${Object.keys(RECORD_TYPES).join('/')}`,
  );
  need(isNonEmptyString(record.title), 'title 不能为空');
  need(asString(record.title).length <= LIMITS.titleMax, `title 超过 ${LIMITS.titleMax} 字符`);
  need(isNonEmptyString(record.statement), 'statement 不能为空');
  need(asString(record.statement).length <= LIMITS.statementMax, `statement 超过 ${LIMITS.statementMax} 字符`);
  need(isNonEmptyString(record.scope), 'scope 不能为空');
  need(asString(record.scope).length <= LIMITS.scopeMax, `scope 超过 ${LIMITS.scopeMax} 字符`);

  // 审核状态：候选只允许 pending，正式记忆只允许 approved
  if (mode === 'candidate') {
    need(record.status === 'pending', "候选记录的 status 必须为 'pending'");
  } else {
    need(record.status === 'approved', "正式记忆的 status 必须为 'approved'");
  }

  need(
    EVIDENCE_KINDS.includes(record.evidence_kind),
    `evidence_kind 必须是 ${EVIDENCE_KINDS.join('/')}`,
  );
  need(
    EVIDENCE_RESULTS.includes(record.evidence_result),
    `evidence_result 必须是 ${EVIDENCE_RESULTS.join('/')}`,
  );
  need(
    VALIDITY.includes(record.validity),
    `validity 必须是 ${VALIDITY.join('/')}`,
  );
  need(typeof record.archived === 'boolean', 'archived 必须是布尔值');
  need(isIsoDate(record.created_at), 'created_at 必须是可解析的时间');
  need(isIsoDate(record.updated_at), 'updated_at 必须是可解析的时间');

  // tags
  if (!Array.isArray(record.tags)) {
    errors.push('tags 必须是数组');
  } else {
    need(record.tags.length <= LIMITS.tagsMax, `tags 超过 ${LIMITS.tagsMax} 个`);
    for (const t of record.tags) need(isNonEmptyString(t), 'tags 元素不能为空');
  }

  // sources：多态 + 类型专属校验
  if (!Array.isArray(record.sources) || record.sources.length === 0) {
    errors.push('sources 至少需要一个来源');
  } else {
    need(record.sources.length <= LIMITS.sourcesMax, `sources 超过 ${LIMITS.sourcesMax} 个`);
    record.sources.forEach((src, i) => {
      if (!src || typeof src !== 'object') {
        errors.push(`sources[${i}] 必须是对象`);
        return;
      }
      const kind = src.kind;
      if (!SOURCE_KINDS.includes(kind)) {
        errors.push(`sources[${i}].kind 必须是 ${SOURCE_KINDS.join('/')}`);
        return;
      }
      const required = SOURCE_REQUIRED_FIELDS[kind] || [];
      for (const field of required) {
        const value = src[field];
        const valid =
          field === 'exit_code'
            ? typeof value === 'number' && Number.isFinite(value)
            : isNonEmptyString(value);
        need(valid, `sources[${i}](${kind}) 缺少必填字段或类型错误 ${field}`);
      }
      for (const group of SOURCE_ALTERNATIVES[kind] || []) {
        const hit = group.some((f) => isNonEmptyString(src[f]));
        need(hit, `sources[${i}](${kind}) 需要 ${group.join(' 或 ')} 至少一个`);
      }
      if (kind === 'command') {
        need(
          src.exit_code === 0 || (typeof src.exit_code === 'number' && src.exit_code !== 0),
          `sources[${i}](command) 的 exit_code 必须是数字`,
        );
      }
    });
  }

  // 撤销/失效必须能说明原因（可选但推荐）：superseded 应带 supersedes
  if (record.validity === 'superseded') {
    need(
      Array.isArray(record.supersedes) && record.supersedes.length > 0,
      'validity=superseded 时需要 supersedes 指明替代者',
    );
  }

  return { ok: errors.length === 0, errors };
}
