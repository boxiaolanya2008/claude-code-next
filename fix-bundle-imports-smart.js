#!/usr/bin/env bun

import { readdir, readFile, writeFile } from 'fs/promises';
import { join, relative, dirname } from 'path';

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
    
    // 检查是否包含 bun:bundle 导入
    if (content.includes("from 'bun:bundle'")) {
      // 计算相对于 src/utils/bundle-mock.ts 的路径
      const fileDir = dirname(filePath);
      const relativePath = relative(fileDir, './src/utils/bundle-mock.ts');
      
      // 构建正确的导入语句
      const importStatement = `import { feature } from "${relativePath}"`;
      
      // 替换 bun:bundle 导入
      const updatedContent = content.replace(/import\s*{[^}]*feature[^}]*}\s*from\s*['"]bun:bundle['"]/g, importStatement);
      
      if (updatedContent !== content) {
        await writeFile(filePath, updatedContent);
        console.log(`Updated: ${filePath}`);
      }
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
