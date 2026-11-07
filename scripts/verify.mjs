// AMH Phase 1 离线闭环验收（零依赖）
// 用法：node scripts/verify.mjs
// 在系统临时目录建一套独立 AMH_ROOT，用子进程调用 CLI 做端到端断言；
// 全部通过输出 PASS（exit 0），失败输出 FAIL + 详情（exit 1）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const cliPath = path.join(repoRoot, 'src', 'cli', 'memory.mjs');
const totalSteps = 7;

let currentStep = 0;

function section(n, title) {
  currentStep = n;
  console.log(`[${n}/${totalSteps}] ${title}`);
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function assertEq(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）`);
  }
}

function assertIncludes(haystack, needle, message) {
  assert(String(haystack).includes(needle), `${message}（输出中未找到 ${JSON.stringify(needle)}）`);
}

function setup(root) {
  const dirs = [
    'config',
    'vault',
    'vault/10-通用',
    'vault/00-索引',
    'vault/_templates',
    'vault/_meta',
    'inbox/candidates',
    'state',
    'logs',
  ];
  for (const dir of dirs) fs.mkdirSync(path.join(root, dir), { recursive: true });

  fs.writeFileSync(
    path.join(root, 'config', 'projects.json'),
    JSON.stringify(
      {
        schema_version: 1,
        vault_root: 'vault',
        projects: {
          shared: { name: '通用', vault_dir: '10-通用', description: '验收用共享项目' },
        },
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  fs.writeFileSync(
    path.join(root, 'config', 'memory-policy.json'),
    JSON.stringify(
      {
        schema_version: 1,
        default_search: { status: ['approved'], validity: ['current'], archived: false },
        require_sources: true,
        require_human_approval: true,
        allowed_source_kinds: ['git', 'command', 'file', 'user-statement', 'doc'],
        external_send: { enabled: false, targets: {} },
        candidate_retention_days: 30,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
}

function makeRunner(root) {
  return function run(args) {
    const result = spawnSync(process.execPath, [cliPath, ...args], {
      cwd: repoRoot,
      env: { ...process.env, AMH_ROOT: root },
      encoding: 'utf8',
      windowsHide: true,
    });
    assert(!result.error, `子进程启动失败：${result.error && result.error.message}`);
    return {
      code: result.status,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      args,
    };
  };
}

function parseJson(result) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(
      `--json 输出无法解析\n    命令：memory.mjs ${result.args.join(' ')}\n`
        + `    stdout：${result.stdout}\n    stderr：${result.stderr}`,
    );
  }
}

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amh-verify-'));
  const run = makeRunner(root);
  let passed = false;

  try {
    setup(root);

    // ---------- 1. 候选添加 ----------
    section(1, '候选添加（candidate add）');
    const candidate = {
      project_id: 'shared',
      type: 'fact',
      title: 'AMH 验收：审核通过后正式记忆可被检索 closed-loop',
      statement: '候选经人工批准后写入正式 vault，并出现在默认检索结果中。',
      scope: 'AMH Phase 1 离线验收',
      tags: ['amh-verify', 'closed-loop'],
      evidence_kind: 'user-confirmed',
      evidence_result: 'passed',
      sources: [
        { kind: 'file', path: 'D:\\Agent Memory Hub\\README.md', hash: 'sha256:verify' },
      ],
      body: '## 主张\n\n验收用事实。\n\n## 证据\n\n- README（sha256:verify）\n\n## 适用范围\n\nAMH Phase 1 离线验收。\n',
    };
    const candidateFile = path.join(root, 'candidate-1.json');
    fs.writeFileSync(candidateFile, JSON.stringify(candidate, null, 2), 'utf8');

    const add = run(['candidate', 'add', '--file', candidateFile, '--json']);
    assertEq(add.code, 0, 'candidate add 应以 0 退出');
    const addData = parseJson(add);
    assertEq(addData.ok, true, 'candidate add 应返回 ok=true');
    const id = String(addData.id || '');
    assert(/^mem-\d{8}-shared-\d{4}$/.test(id), `候选 ID 应形如 mem-YYYYMMDD-shared-NNNN，实际 ${id}`);
    const candidatePath = path.join(root, 'inbox', 'candidates', `${id}.json`);
    assert(fs.existsSync(candidatePath), '候选文件应写入 inbox/candidates');

    const statusResult = run(['status', '--json']);
    assertEq(statusResult.code, 0, 'status 应以 0 退出');
    const status0 = parseJson(statusResult);
    assertEq(status0.memory_total, 0, '此时正式记忆数应为 0');
    assertEq(status0.candidate_total, 1, '此时候选数应为 1');
    console.log('        ok：候选写入 inbox，正式记忆仍为空');

    // ---------- 2. 未审核不进检索 ----------
    section(2, '未审核候选不进入检索');
    const search0 = run(['search', '--project', 'shared', '--query', 'closed-loop', '--json']);
    assertEq(search0.code, 0, 'search 应以 0 退出');
    const search0Data = parseJson(search0);
    assertEq(search0Data.records.length, 0, '未审核时检索结果应为空');
    console.log('        ok：search 返回 0 条');

    // ---------- 3. 审核通过后可检索 ----------
    section(3, 'review approve 生成正式记忆并可检索');
    const approve = run(['review', 'approve', id, '--reviewer', 'verify', '--json']);
    assertEq(approve.code, 0, `review approve 应以 0 退出\n    stderr：${approve.stderr}`);
    const approveData = parseJson(approve);
    assertEq(approveData.ok, true, 'review approve 应返回 ok=true');

    const memoryFile = path.join(root, 'vault', '10-通用', 'architecture', `${id}.md`);
    assert(fs.existsSync(memoryFile), `正式记忆文件应存在：${memoryFile}`);
    const memoryText = fs.readFileSync(memoryFile, 'utf8');
    assert(/^status: approved$/m.test(memoryText), '正式记忆 status 应为 approved');
    assert(/^validity: current$/m.test(memoryText), '正式记忆 validity 应为 current');
    assert(/^id: /m.test(memoryText), '正式记忆应包含 frontmatter');

    const search1 = parseJson(run(['search', '--project', 'shared', '--query', 'closed-loop', '--json']));
    assertEq(search1.records.length, 1, '批准后检索应命中 1 条');
    assertEq(search1.records[0].id, id, '检索命中记录 ID 应一致');

    const readResult = run(['read', id, '--json']);
    assertEq(readResult.code, 0, 'read 应以 0 退出');
    const readBack = parseJson(readResult);
    assertEq(readBack.meta.id, id, 'read 返回的 meta.id 应一致');
    assertIncludes(readBack.body, '验收用事实', 'read 应返回正文');
    console.log('        ok：正式记忆落盘且可检索 / read');

    // ---------- 4. 索引可重建 ----------
    section(4, '删除 state/index.json 后可重建且内容一致');
    const indexPath = path.join(root, 'state', 'index.json');
    assert(fs.existsSync(indexPath), 'approve 后应生成 state/index.json');
    const before = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    assertEq(before.records.length, 1, '重建前索引应有 1 条记录');
    fs.rmSync(indexPath);
    assert(!fs.existsSync(indexPath), '测试前置：state/index.json 应已删除');

    const rebuild = run(['index', 'rebuild', '--json']);
    assertEq(rebuild.code, 0, 'index rebuild 应以 0 退出');
    assert(fs.existsSync(indexPath), 'index rebuild 应重建 state/index.json');
    const after = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    assertEq(
      JSON.stringify(after.records),
      JSON.stringify(before.records),
      '重建后的索引记录应与删除前一致',
    );
    assertEq(after.records[0].id, id, '索引记录 ID 应一致');

    const mdIndexPath = path.join(root, 'vault', '00-索引', 'INDEX.md');
    assert(fs.existsSync(mdIndexPath), 'index rebuild 应生成 00-索引/INDEX.md');
    assertIncludes(fs.readFileSync(mdIndexPath, 'utf8'), id, 'INDEX.md 应包含记忆 ID');
    console.log('        ok：index.json 内容一致，INDEX.md 已生成');

    // ---------- 5. 撤销后不再检索 ----------
    section(5, 'validity 改为 revoked 后默认检索不再返回');
    const revokedText = memoryText.replace(/^validity: current$/m, 'validity: revoked');
    assert(revokedText !== memoryText, '测试前置：正式记忆应包含 validity: current');
    fs.writeFileSync(memoryFile, revokedText, 'utf8');

    const search2 = parseJson(run(['search', '--project', 'shared', '--query', 'closed-loop', '--json']));
    assertEq(search2.records.length, 0, 'validity=revoked 后默认检索应为空');

    const search3 = parseJson(
      run(['search', '--project', 'shared', '--query', 'closed-loop', '--include-stale', '--json']),
    );
    assertEq(search3.records.length, 1, '--include-stale 时应可查到已失效记忆');
    console.log('        ok：默认过滤排除失效记忆，显式 include-stale 可查到');

    // ---------- 6. 校验器 ----------
    section(6, 'validate：合法记录 exit 0，缺 sources 的候选 exit 1');
    const valid = run(['validate', '--json']);
    assertEq(valid.code, 0, `合法记录时 validate 应以 0 退出\n    stdout：${valid.stdout}`);
    const validData = parseJson(valid);
    assertEq(validData.ok, true, '合法记录时 validate 应返回 ok=true');

    const badCandidate = {
      schema_version: 1,
      id: 'cand-bad-0001',
      project_id: 'shared',
      type: 'fact',
      title: '缺来源的候选',
      statement: '这条候选没有 sources，应被校验拦截。',
      status: 'pending',
      evidence_kind: 'none',
      evidence_result: 'not-run',
      validity: 'current',
      archived: false,
      scope: 'AMH 验收',
      tags: [],
      sources: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const badPath = path.join(root, 'inbox', 'candidates', 'cand-bad-0001.json');
    fs.writeFileSync(badPath, JSON.stringify(badCandidate, null, 2), 'utf8');

    const invalid = run(['validate', '--json']);
    assertEq(invalid.code, 1, '存在缺 sources 的候选时 validate 应以 1 退出');
    const invalidData = parseJson(invalid);
    assertEq(invalidData.ok, false, '存在非法记录时 validate 应返回 ok=false');
    assertIncludes(JSON.stringify(invalidData.errors), 'sources', 'validate 应指出 sources 缺失');
    console.log('        ok：合法 exit 0，非法候选 exit 1');

    // ---------- 7. reject 保护 ----------
    section(7, 'reject 保护：已晋升拦截 / 正常拒绝 / 重复拒绝拦截');
    const rejectPromoted = run(['review', 'reject', id, '--reason', '测试已晋升保护', '--json']);
    assertEq(rejectPromoted.code, 1, '已晋升候选 reject 应以 1 退出');
    assertIncludes(rejectPromoted.stdout, '已晋升', '错误信息应说明已晋升');
    const promotedCandidate = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
    assertEq(promotedCandidate.status, 'pending', '已晋升候选状态应保持 pending');

    const candidate2 = {
      project_id: 'shared',
      type: 'fact',
      title: 'AMH 验收：reject 保护测试',
      statement: '用于验证正常 reject 与重复 reject 保护。',
      scope: 'AMH Phase 1 离线验收',
      tags: ['amh-verify', 'reject-protection'],
      evidence_kind: 'user-confirmed',
      evidence_result: 'passed',
      sources: [
        { kind: 'file', path: 'D:\\Agent Memory Hub\\README.md', hash: 'sha256:verify' },
      ],
      body: '## 主张\n\n拒绝保护验收。\n',
    };
    const candidateFile2 = path.join(root, 'candidate-2.json');
    fs.writeFileSync(candidateFile2, JSON.stringify(candidate2, null, 2), 'utf8');
    const add2 = parseJson(run(['candidate', 'add', '--file', candidateFile2, '--json']));
    const id2 = String(add2.id || '');
    assert(id2, '第二个候选应返回 id');

    const eventsPath = path.join(root, 'logs', 'events.jsonl');
    const countEvents = () => (fs.existsSync(eventsPath)
      ? fs.readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean).length
      : 0);
    const eventsBefore = countEvents();

    const reject1 = run(['review', 'reject', id2, '--reason', '测试正常拒绝', '--json']);
    assertEq(reject1.code, 0, `正常候选 reject 应以 0 退出\n    stderr：${reject1.stderr}`);
    const eventsAfterFirst = countEvents();
    assertEq(eventsAfterFirst, eventsBefore + 1, '正常 reject 应追加 1 条事件');

    const reject2 = run(['review', 'reject', id2, '--reason', '重复拒绝', '--json']);
    assertEq(reject2.code, 1, '重复 reject 应以 1 退出');
    assertIncludes(reject2.stdout, '已拒绝', '错误信息应说明已拒绝');
    assertEq(countEvents(), eventsAfterFirst, '重复 reject 不应追加事件');
    console.log('        ok：已晋升拦截 / 正常 reject / 重复 reject 拦截');

    passed = true;
  } catch (err) {
    console.log('');
    console.log('FAIL');
    console.log(`  第 ${currentStep} 组断言失败：${err && err.message ? err.message : String(err)}`);
    console.log(`  临时 AMH_ROOT 已保留供排查：${root}`);
    process.exitCode = 1;
  } finally {
    if (passed) {
      try {
        fs.rmSync(root, { recursive: true, force: true });
      } catch {
        // 清理失败不影响验收结论
      }
    }
  }

  if (passed) {
    console.log('');
    console.log(`PASS（${totalSteps} 组断言全部通过）`);
  }
}

main();
