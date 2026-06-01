// scripts/copy-core-engine.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sourceDir = path.resolve(__dirname, '../js/core-engine');
const targetDir = path.resolve(__dirname, '../functions/src/core-engine');

function copyFolderSync(from, to) {
    if (!fs.existsSync(to)) {
        fs.mkdirSync(to, { recursive: true });
    }

    const items = fs.readdirSync(from);
    for (const item of items) {
        const fromPath = path.join(from, item);
        const toPath = path.join(to, item);
        const stat = fs.statSync(fromPath);

        if (stat.isFile()) {
            fs.copyFileSync(fromPath, toPath);
            console.log(`Copied: ${item}`);
        } else if (stat.isDirectory()) {
            copyFolderSync(fromPath, toPath);
        }
    }
}

try {
    console.log(`Copying core-engine from ${sourceDir} to ${targetDir}...`);
    copyFolderSync(sourceDir, targetDir);
    console.log('Successfully copied core-engine to functions directory.');

    const utilsSource = path.resolve(__dirname, '../js/utils/precisionCalculation.js');
    const utilsTargetDir = path.resolve(__dirname, '../functions/src/utils');
    const utilsTarget = path.resolve(utilsTargetDir, 'precisionCalculation.js');
    
    if (!fs.existsSync(utilsTargetDir)) {
        fs.mkdirSync(utilsTargetDir, { recursive: true });
    }
    fs.copyFileSync(utilsSource, utilsTarget);
    console.log('Successfully copied precisionCalculation.js to functions/src/utils directory.');

} catch (error) {
    console.error('Error copying core-engine:', error);
    process.exit(1);
}
