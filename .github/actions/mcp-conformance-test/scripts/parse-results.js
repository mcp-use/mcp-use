#!/usr/bin/env node

/**
 * Parse MCP Conformance Test Results
 * 
 * Parses the output from @modelcontextprotocol/conformance CLI
 * and generates structured JSON results with pass/fail counts and individual test results.
 */

const fs = require('fs');
const path = require('path');

const RESULTS_DIR = 'conformance-results';

/**
 * Parse conformance test output file
 * @param {string} filePath - Path to the conformance output file
 * @returns {object} - Parsed results with passed, failed, rate, and tests
 */
function parseConformanceOutput(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  Results file not found: ${filePath}`);
    return null;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  const results = {
    passed: 0,
    failed: 0,
    rate: '0.0',
    tests: {}
  };

  for (const line of lines) {
    // Match lines with checkmark (✓) or cross (✗)
    const passMatch = line.match(/✓\s+([^\s:]+)/);
    const failMatch = line.match(/✗\s+([^\s:]+)/);

    if (passMatch) {
      const testName = passMatch[1].trim();
      results.tests[testName] = true;
      results.passed++;
    } else if (failMatch) {
      const testName = failMatch[1].trim();
      results.tests[testName] = false;
      results.failed++;
    }
  }

  // Calculate pass rate
  const total = results.passed + results.failed;
  if (total > 0) {
    results.rate = ((results.passed / total) * 100).toFixed(1);
  }

  return results;
}

/**
 * Main function
 */
function main() {
  console.log('📊 Parsing conformance test results...\n');

  // Ensure results directory exists
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }

  // Parse Python results
  const pythonOutputPath = path.join(RESULTS_DIR, 'python-conformance-output.txt');
  const pythonResults = parseConformanceOutput(pythonOutputPath);
  
  if (pythonResults) {
    const pythonResultsPath = path.join(RESULTS_DIR, 'python-results.json');
    fs.writeFileSync(pythonResultsPath, JSON.stringify(pythonResults, null, 2));
    console.log(`✅ Python results: ${pythonResults.passed}/${pythonResults.passed + pythonResults.failed} passed (${pythonResults.rate}%)`);
    console.log(`   Saved to: ${pythonResultsPath}`);
  }

  // Parse TypeScript results
  const tsOutputPath = path.join(RESULTS_DIR, 'typescript-conformance-output.txt');
  const tsResults = parseConformanceOutput(tsOutputPath);
  
  if (tsResults) {
    const tsResultsPath = path.join(RESULTS_DIR, 'typescript-results.json');
    fs.writeFileSync(tsResultsPath, JSON.stringify(tsResults, null, 2));
    console.log(`✅ TypeScript results: ${tsResults.passed}/${tsResults.passed + tsResults.failed} passed (${tsResults.rate}%)`);
    console.log(`   Saved to: ${tsResultsPath}`);
  }

  if (!pythonResults && !tsResults) {
    console.error('❌ No conformance test results found!');
    process.exit(1);
  }

  console.log('\n✅ Results parsing completed!');
}

// Run main function
if (require.main === module) {
  main();
}

module.exports = { parseConformanceOutput };

