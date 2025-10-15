#!/usr/bin/env node

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sourceDir = path.join(__dirname, '..', 'src', 'templates');
const targetDir = path.join(__dirname, '..', 'dist', 'templates');

async function copyDir(src, dest, excludeDirs = ['node_modules']) {
  try {
    await fs.mkdir(dest, { recursive: true });
    
    const entries = await fs.readdir(src, { withFileTypes: true });
    
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      
      // Skip excluded directories
      if (entry.isDirectory() && excludeDirs.includes(entry.name)) {
        console.log(`Skipping ${entry.name}/`);
        continue;
      }
      
      if (entry.isDirectory()) {
        await copyDir(srcPath, destPath, excludeDirs);
      } else {
        await fs.copyFile(srcPath, destPath);
        console.log(`Copied ${entry.name}`);
      }
    }
  } catch (error) {
    console.error('Error copying templates:', error);
    process.exit(1);
  }
}

// Ensure target directory exists
await fs.mkdir(targetDir, { recursive: true });

console.log('Copying templates...');
await copyDir(sourceDir, targetDir);
console.log('Templates copied successfully!');
