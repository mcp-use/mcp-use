#!/usr/bin/env node

/**
 * Generate Badge Data for MCP Conformance Tests
 * 
 * Creates shields.io compatible badge data for displaying test results
 */

const fs = require('fs');
const path = require('path');

const RESULTS_DIR = 'conformance-results';

/**
 * Load JSON results safely
 * @param {string} filePath - Path to JSON file
 * @returns {object|null} - Parsed JSON or null
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
  return null;
}

/**
 * Get badge color based on pass rate
 * @param {number} rate - Pass rate percentage
 * @returns {string} - Badge color
 */
function getBadgeColor(rate) {
  if (rate >= 90) return 'brightgreen';
  if (rate >= 75) return 'green';
  if (rate >= 60) return 'yellowgreen';
  if (rate >= 50) return 'yellow';
  if (rate >= 25) return 'orange';
  return 'red';
}

/**
 * Generate badge data for shields.io
 * @param {object} pythonResults - Python test results
 * @param {object} typescriptResults - TypeScript test results
 * @returns {object} - Badge data object
 */
function generateBadgeData(pythonResults, typescriptResults) {
  const badges = {};

  // Python badge
  if (pythonResults) {
    const rate = parseFloat(pythonResults.rate);
    badges.python = {
      schemaVersion: 1,
      label: 'Python MCP',
      message: `${pythonResults.passed}/${pythonResults.passed + pythonResults.failed} (${pythonResults.rate}%)`,
      color: getBadgeColor(rate),
      namedLogo: 'python',
      logoColor: 'white'
    };
  }

  // TypeScript badge
  if (typescriptResults) {
    const rate = parseFloat(typescriptResults.rate);
    badges.typescript = {
      schemaVersion: 1,
      label: 'TypeScript MCP',
      message: `${typescriptResults.passed}/${typescriptResults.passed + typescriptResults.failed} (${typescriptResults.rate}%)`,
      color: getBadgeColor(rate),
      namedLogo: 'typescript',
      logoColor: 'white'
    };
  }

  // Combined badge
  if (pythonResults && typescriptResults) {
    const totalPassed = pythonResults.passed + typescriptResults.passed;
    const totalTests = (pythonResults.passed + pythonResults.failed) + 
                      (typescriptResults.passed + typescriptResults.failed);
    const combinedRate = totalTests > 0 ? ((totalPassed / totalTests) * 100).toFixed(1) : '0.0';
    
    badges.combined = {
      schemaVersion: 1,
      label: 'MCP Conformance',
      message: `${totalPassed}/${totalTests} (${combinedRate}%)`,
      color: getBadgeColor(parseFloat(combinedRate)),
      style: 'flat'
    };
  }

  // Shields.io URL format
  badges.urls = {};
  
  if (badges.python) {
    const encoded = encodeURIComponent(JSON.stringify(badges.python));
    badges.urls.python = `https://img.shields.io/endpoint?url=data:application/json;base64,${Buffer.from(JSON.stringify(badges.python)).toString('base64')}`;
  }
  
  if (badges.typescript) {
    const encoded = encodeURIComponent(JSON.stringify(badges.typescript));
    badges.urls.typescript = `https://img.shields.io/endpoint?url=data:application/json;base64,${Buffer.from(JSON.stringify(badges.typescript)).toString('base64')}`;
  }
  
  if (badges.combined) {
    const encoded = encodeURIComponent(JSON.stringify(badges.combined));
    badges.urls.combined = `https://img.shields.io/endpoint?url=data:application/json;base64,${Buffer.from(JSON.stringify(badges.combined)).toString('base64')}`;
  }

  return badges;
}

/**
 * Main function
 */
function main() {
  console.log('🎨 Generating badge data...\n');

  // Load results
  const pythonResults = loadResults(path.join(RESULTS_DIR, 'python-results.json'));
  const typescriptResults = loadResults(path.join(RESULTS_DIR, 'typescript-results.json'));

  if (!pythonResults && !typescriptResults) {
    console.log('⚠️  No results found to generate badges from');
    return;
  }

  // Generate badge data
  const badgeData = generateBadgeData(pythonResults, typescriptResults);

  // Save badge data
  const badgeDataPath = path.join(RESULTS_DIR, 'badge-data.json');
  fs.writeFileSync(badgeDataPath, JSON.stringify(badgeData, null, 2));

  console.log('✅ Badge data generated:');
  if (badgeData.python) {
    console.log(`   Python: ${badgeData.python.message} (${badgeData.python.color})`);
  }
  if (badgeData.typescript) {
    console.log(`   TypeScript: ${badgeData.typescript.message} (${badgeData.typescript.color})`);
  }
  if (badgeData.combined) {
    console.log(`   Combined: ${badgeData.combined.message} (${badgeData.combined.color})`);
  }
  console.log(`   Saved to: ${badgeDataPath}`);

  // Display example usage
  if (Object.keys(badgeData.urls).length > 0) {
    console.log('\n📝 Example badge markdown:');
    if (badgeData.urls.combined) {
      console.log(`   ![MCP Conformance](${badgeData.urls.combined})`);
    }
    if (badgeData.urls.python) {
      console.log(`   ![Python MCP](${badgeData.urls.python})`);
    }
    if (badgeData.urls.typescript) {
      console.log(`   ![TypeScript MCP](${badgeData.urls.typescript})`);
    }
  }

  console.log('\n✅ Badge generation completed!');
}

// Run main function
if (require.main === module) {
  main();
}

module.exports = { generateBadgeData, getBadgeColor };

