#!/usr/bin/env bun

import { readdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

async function processDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    
    if (entry.isDirectory()) {
      await processDirectory(fullPath);
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') || entry.name.endsWith('.js') || entry.name.endsWith('.jsx'))) {
      await processFile(fullPath);
    }
  }
}

async function processFile(filePath) {
  try {
    const content = await readFile(filePath, 'utf8');
    
    // 替换 bun:bundle 导入
    const updatedContent = content.replace(/import\s*{[^}]*feature[^}]*}\s*from\s*['"]bun:bundle['"]/g, 'import { feature } from "../utils/bundle-mock.ts"');
    
    if (updatedContent !== content) {
      await writeFile(filePath, updatedContent);
      console.log(`Updated: ${filePath}`);
    }
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error);
  }
}

// 运行脚本
processDirectory('./src').then(() => {
  console.log('\nAll files processed!');
}).catch(error => {
  console.error('Error:', error);
});
