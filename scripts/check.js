const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function check(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) check(file);
        else if (entry.name.endsWith('.js')) {
            const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
            if (result.status !== 0) { process.stderr.write(result.stderr); process.exitCode = 1; }
        }
    }
}
check(path.resolve(__dirname, '..'));
if (!process.exitCode) console.log('Sintaxis JavaScript correcta');
