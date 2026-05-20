const fs = require('fs');
const path = require('path');

const i18nPath = path.join(__dirname, 'js', 'utils', 'i18n.js');
let i18nContent = fs.readFileSync(i18nPath, 'utf8');

const definedKeys = new Set();
const keyRegex = /'([^']+)':\s*\{/g;
let match;
while ((match = keyRegex.exec(i18nContent)) !== null) {
  definedKeys.add(match[1].toLowerCase());
}

const ignoredKeys = new Set([
  'sv', 'en', 'precision_start', 'marathon_stages_stop'
]);

const filesToScan = [];
function walkDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      if (
        file !== 'node_modules' && 
        file !== '.git' && 
        file !== 'archive' && 
        file !== 'tests' && 
        file !== 'test-results' &&
        file !== 'playwright-report'
      ) {
        walkDir(fullPath);
      }
    } else {
      if (fullPath.endsWith('.js') || fullPath.endsWith('.html')) {
        filesToScan.push(fullPath);
      }
    }
  }
}
walkDir(__dirname);

const usedKeys = new Map();

for (const file of filesToScan) {
  if (file.includes('i18n.js') || file.includes('audit_i18n')) continue;
  const content = fs.readFileSync(file, 'utf8');
  
  // Look for exactly t('key') or t("key") or t(`key`) with word boundary on t
  const usageRegex = /\bt\(['"\`]([a-zA-Z0-9_]+)['"\`]\)/g;
  let usageMatch;
  while ((usageMatch = usageRegex.exec(content)) !== null) {
    const key = usageMatch[1].toLowerCase();
    if (!ignoredKeys.has(key)) {
      if (!usedKeys.has(key)) usedKeys.set(key, new Set());
      usedKeys.get(key).add(file.replace(__dirname, ''));
    }
  }
}

const missingKeys = [];
for (const [key, files] of usedKeys.entries()) {
  if (!definedKeys.has(key)) {
    missingKeys.push({ key, files: Array.from(files) });
  }
}

if (missingKeys.length > 0) {
  console.log("Found missing i18n keys:");
  for (const item of missingKeys) {
    console.log(`- ${item.key} (used in: ${item.files.join(', ')})`);
  }
} else {
  console.log("All i18n keys used in code are defined in i18n.js!");
}
