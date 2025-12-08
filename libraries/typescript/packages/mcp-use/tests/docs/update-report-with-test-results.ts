/**
 * Script to run tests and update the report with actual test results
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
const PACKAGE_ROOT = path.resolve(__dirname, "../..");
const PROJECT_ROOT = path.resolve(PACKAGE_ROOT, "../../../..");
const REPORT_PATH = path.join(PROJECT_ROOT, "report.md");

interface TestResult {
  testFile: string;
  passed: number;
  failed: number;
}

async function runTestsAndGetResults(): Promise<TestResult[]> {
  console.log("🧪 Running all documentation tests...\n");

  try {
    // Run tests and capture output
    const { stdout } = await execAsync("pnpm test:run tests/docs/", {
      cwd: PACKAGE_ROOT,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });

    // Parse test results from vitest output
    const results: TestResult[] = [];
    const lines = stdout.split("\n");

    for (const line of lines) {
      // Match lines like: " ✓ tests/docs/server/api-reference.test.ts (44 tests) 5ms"
      const match = line.match(
        /✓\s+(tests\/docs\/server\/.*\.test\.ts)\s+\((\d+)\s+tests?\)/
      );
      if (match) {
        results.push({
          testFile: match[1],
          passed: parseInt(match[2], 10),
          failed: 0,
        });
      }
    }

    return results;
  } catch (error: any) {
    // Tests may fail, but we still want to parse the results
    const results: TestResult[] = [];
    const output = error.stdout || "";
    const lines = output.split("\n");

    for (const line of lines) {
      const passMatch = line.match(
        /✓\s+(tests\/docs\/server\/.*\.test\.ts)\s+\((\d+)\s+tests?\)/
      );
      if (passMatch) {
        results.push({
          testFile: passMatch[1],
          passed: parseInt(passMatch[2], 10),
          failed: 0,
        });
      }

      const failMatch = line.match(
        /❯\s+(tests\/docs\/server\/.*\.test\.ts)\s+\((\d+)\s+tests?\s+\|\s+(\d+)\s+failed\)/
      );
      if (failMatch) {
        results.push({
          testFile: failMatch[1],
          passed: parseInt(failMatch[2], 10) - parseInt(failMatch[3], 10),
          failed: parseInt(failMatch[3], 10),
        });
      }
    }

    return results;
  }
}

async function updateReport(testResults: TestResult[]) {
  console.log("📝 Updating report with test results...\n");

  // Read current report
  const report = fs.readFileSync(REPORT_PATH, "utf-8");
  const lines = report.split("\n");

  // Update test results in the report
  const updatedLines: string[] = [];
  let currentTestFile = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for test file reference
    if (line.startsWith("**Test File**:")) {
      const match = line.match(/\[`([^`]+)`\]/);
      if (match) {
        currentTestFile = match[1];
      }
    }

    // Update test counts
    if (line.startsWith("**Tests**: ") && currentTestFile) {
      // Find matching test result
      const testFileToMatch = currentTestFile;
      const testResult = testResults.find(
        (r) =>
          testFileToMatch.includes(r.testFile) ||
          r.testFile.includes(path.basename(testFileToMatch))
      );

      if (testResult) {
        const total = testResult.passed + testResult.failed;
        updatedLines.push(
          `**Tests**: ${total} (${testResult.passed} passed, ${testResult.failed} failed)`
        );
        continue;
      }
    }

    updatedLines.push(line);
  }

  // Write updated report
  fs.writeFileSync(REPORT_PATH, updatedLines.join("\n"), "utf-8");
  console.log(`✅ Report updated at: ${REPORT_PATH}\n`);
}

async function main() {
  console.log("📊 Updating Documentation Audit Report with Test Results\n");

  const testResults = await runTestsAndGetResults();

  console.log(`\n✅ Collected results from ${testResults.length} test files`);

  const totalTests = testResults.reduce(
    (sum, r) => sum + r.passed + r.failed,
    0
  );
  const totalPassed = testResults.reduce((sum, r) => sum + r.passed, 0);
  const totalFailed = testResults.reduce((sum, r) => sum + r.failed, 0);

  console.log(`   Total Tests: ${totalTests}`);
  console.log(`   Passed: ${totalPassed}`);
  console.log(`   Failed: ${totalFailed}\n`);

  await updateReport(testResults);

  console.log("✨ Report update complete!\n");
}

main().catch(console.error);
