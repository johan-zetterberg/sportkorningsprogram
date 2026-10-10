// scripts/copy-core-engine.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '..');

export const syncTargets = [
    ['js/core-engine', 'functions/src/core-engine'],
    ['js/data/dressagePrograms.js', 'functions/src/data/dressagePrograms.js'],
    ['js/data/competitionData.js', 'functions/src/data/competitionData.js'],
    ['js/utils/precisionCalculation.js', 'functions/src/utils/precisionCalculation.js']
];

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
    console.log('Synchronizing result engine and its data dependencies...');
    for (const [sourceRelative, targetRelative] of syncTargets) {
        const sourcePath = path.resolve(projectRoot, sourceRelative);
        const targetPath = path.resolve(projectRoot, targetRelative);
        const sourceStat = fs.statSync(sourcePath);

        if (sourceStat.isDirectory()) {
            copyFolderSync(sourcePath, targetPath);
        } else {
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            fs.copyFileSync(sourcePath, targetPath);
            console.log(`Copied: ${sourceRelative}`);
        }
    }
    console.log('Successfully synchronized the result engine.');
} catch (error) {
    console.error('Error synchronizing the result engine:', error);
    process.exit(1);
}
