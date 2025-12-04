/**
 * PR Comment Script for MCP Conformance Tests
 * 
 * Posts or updates PR comments with conformance test results and baseline comparisons
 */

const fs = require('fs');
const path = require('path');

/**
 * Load JSON results safely
 * @param {string} filePath - Path to JSON file
 * @returns {object} - Parsed JSON or default empty results
 */
function loadResults(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    }
  } catch (e) {
    console.log(`Failed to load ${filePath}:`, e.message);
  }
  return { passed: 0, failed: 0, rate: '0.0', tests: {} };
}

/**
 * Get comparison icon between current and baseline results
 * @param {object} current - Current test results
 * @param {object} baseline - Baseline test results
 * @returns {string} - Comparison icon/text
 */
function getComparisonIcon(current, baseline) {
  if (!baseline || baseline.passed === 0) return '🆕';
  const diff = current.passed - baseline.passed;
  if (diff > 0) return `🟢 +${diff}`;
  if (diff < 0) return `🔴 ${diff}`;
  return '⚪ +0';
}

/**
 * Main comment function
 * @param {object} params - Parameters object with github, context, core
 */
async function commentOnPR({ github, context, core }) {
  const commentMode = process.env.COMMENT_MODE || 'update';
  const baselineBranches = (process.env.BASELINE_BRANCHES || 'main').split(',').map(b => b.trim());
  
  console.log(`💬 Posting PR comment (mode: ${commentMode})...`);

  // Load current results
  const pyResults = loadResults('conformance-results/python-results.json');
  const tsResults = loadResults('conformance-results/typescript-results.json');

  // Load baseline results from all specified branches
  const baselines = {};
  for (const branch of baselineBranches) {
    const branchKey = branch.replace(/[^a-zA-Z0-9]/g, '-');
    baselines[branch] = {
      python: loadResults(`baseline-${branchKey}/python-results.json`),
      typescript: loadResults(`baseline-${branchKey}/typescript-results.json`)
    };
  }

  // Get comparison icons for the first baseline (typically 'main')
  const primaryBaseline = baselineBranches[0];
  const pyVsPrimary = getComparisonIcon(pyResults, baselines[primaryBaseline]?.python);
  const tsVsPrimary = getComparisonIcon(tsResults, baselines[primaryBaseline]?.typescript);

  // Get all unique test names from both servers
  const allTests = [...new Set([
    ...Object.keys(pyResults.tests || {}),
    ...Object.keys(tsResults.tests || {})
  ])].sort();

  // Build the comparison columns for other baselines
  const comparisonHeaders = baselineBranches.map(branch => `vs ${branch}`).join(' | ');
  const comparisonSeparators = baselineBranches.map(() => ':-------:').join(' | ');
  
  // Build Python comparison cells
  const pyComparisons = baselineBranches.map(branch => 
    getComparisonIcon(pyResults, baselines[branch]?.python)
  ).join(' | ');
  
  // Build TypeScript comparison cells
  const tsComparisons = baselineBranches.map(branch => 
    getComparisonIcon(tsResults, baselines[branch]?.typescript)
  ).join(' | ');

  // Build test columns header
  const testHeaders = allTests.map(t => t.replace(/-/g, '&#8209;')).join(' | ');
  const headerSeparator = allTests.map(() => ':---:').join(' | ');

  // Build Python row with test results and change indicators
  const pyTestCells = allTests.map(test => {
    const current = pyResults.tests[test];
    const baseline = baselines[primaryBaseline]?.python?.tests[test];
    
    let icon = '➖';
    if (current === true) icon = '✅';
    else if (current === false) icon = '❌';
    
    // Add change indicator if changed from baseline
    if (baseline !== undefined && baseline !== current) {
      if (current === true && baseline === false) return `${icon} +1`;
      if (current === false && baseline === true) return `${icon} -1`;
    }
    
    return icon;
  }).join(' | ');

  // Build TypeScript row with test results and change indicators
  const tsTestCells = allTests.map(test => {
    const current = tsResults.tests[test];
    const baseline = baselines[primaryBaseline]?.typescript?.tests[test];
    
    let icon = '➖';
    if (current === true) icon = '✅';
    else if (current === false) icon = '❌';
    
    // Add change indicator if changed from baseline
    if (baseline !== undefined && baseline !== current) {
      if (current === true && baseline === false) return `${icon} +1`;
      if (current === false && baseline === true) return `${icon} -1`;
    }
    
    return icon;
  }).join(' | ');

  // Get commit info
  const sha = context.sha.substring(0, 7);
  const runUrl = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`;

  // Build the comment body
  const body = [
    '<h2>',
    '<picture style="display: inline-block; vertical-align: middle; margin-right: 8px;">',
    '  <source media="(prefers-color-scheme: dark)" srcset="https://registry.npmmirror.com/@lobehub/icons-static-png/1.74.0/files/dark/mcp.png">',
    '  <source media="(prefers-color-scheme: light)" srcset="https://registry.npmmirror.com/@lobehub/icons-static-png/1.74.0/files/light/mcp.png">',
    '  <img alt="MCP" src="https://registry.npmmirror.com/@lobehub/icons-static-png/1.74.0/files/light/mcp.png" height="32" width="32" style="display: inline-block; vertical-align: middle;">',
    '</picture>',
    '<span style="vertical-align: middle;">MCP Conformance Test Results</span>',
    '</h2>',
    '',
    `**Commit:** \`${sha}\``,
    ''
  ];

  // Add table with results
  if (allTests.length > 0) {
    body.push(`| Server | Overall | ${comparisonHeaders} | ${testHeaders} |`);
    body.push(`|--------|:-------:|${comparisonSeparators}|${headerSeparator}|`);
    
    if (pyResults.passed + pyResults.failed > 0) {
      body.push(`| Python | ${pyResults.rate}% | ${pyComparisons} | ${pyTestCells} |`);
    }
    
    if (tsResults.passed + tsResults.failed > 0) {
      body.push(`| TypeScript | ${tsResults.rate}% | ${tsComparisons} | ${tsTestCells} |`);
    }
  } else {
    body.push('⚠️ No test results available.');
  }

  body.push('');
  body.push(`[View full run details](${runUrl})`);
  body.push('');
  body.push('<!-- mcp-conformance-test-comment -->');

  const commentBody = body.join('\n');

  try {
    if (commentMode === 'update') {
      // Find existing comment and update it
      const comments = await github.rest.issues.listComments({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.issue.number
      });

      const existingComment = comments.data.find(comment => 
        comment.body?.includes('<!-- mcp-conformance-test-comment -->')
      );

      if (existingComment) {
        await github.rest.issues.updateComment({
          owner: context.repo.owner,
          repo: context.repo.repo,
          comment_id: existingComment.id,
          body: commentBody
        });
        console.log('✅ Updated existing PR comment');
      } else {
        await github.rest.issues.createComment({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: context.issue.number,
          body: commentBody
        });
        console.log('✅ Created new PR comment');
      }
    } else {
      // Append mode - always create new comment
      await github.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.issue.number,
        body: commentBody
      });
      console.log('✅ Created new PR comment (append mode)');
    }
  } catch (error) {
    console.error('❌ Failed to post PR comment:', error.message);
    core.setFailed(`Failed to post PR comment: ${error.message}`);
  }
}

module.exports = commentOnPR;

