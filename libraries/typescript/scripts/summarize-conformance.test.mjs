import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const SCRIPT = fileURLToPath(new URL('./summarize-conformance.mjs', import.meta.url));

function makeResults(root, suitePath, checks) {
  const dir = join(root, suitePath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'checks.json'), JSON.stringify(checks, null, 2));
}

function runSummarize(root, ef) {
  const args = [SCRIPT, root, '--output', join(root, 'summary.md')];
  if (ef) args.push('--expected-failures', ef);
  return execFileSync('node', args, { encoding: 'utf8' });
}

function runSummarizeWithExitCode(root, ef) {
  try { runSummarize(root, ef); return 0; } catch (err) { return err.status ?? 1; }
}

describe('summarize-conformance', () => {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'conf-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('exits 0 when all checks pass', () => {
    makeResults(tmp, '2025-11-25/server/server-tools-call-sampling-123Z', [{ id: 'c1', status: 'SUCCESS' }]);
    assert.equal(runSummarizeWithExitCode(tmp), 0);
  });

  it('exits 1 on an unexpected FAILURE', () => {
    makeResults(tmp, '2026-07-28/server/server-tools-call-sampling-123Z', [{ id: 'c1', status: 'FAILURE' }]);
    assert.equal(runSummarizeWithExitCode(tmp), 1);
  });

  it('exits 1 on an unexpected WARNING', () => {
    makeResults(tmp, '2026-07-28/server/server-tools-call-sampling-123Z', [{ id: 'c1', status: 'WARNING' }]);
    assert.equal(runSummarizeWithExitCode(tmp), 1);
  });
});
