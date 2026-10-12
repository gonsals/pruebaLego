const { loadEnvironment, getConfig } = require('../lib/config');
const { runScan } = require('../lib/scan');

loadEnvironment();
runScan(getConfig(), { dryRun: process.argv.includes('--dry-run') }).then(result => {
    console.log(JSON.stringify(result, null, 2));
    if (result.failures.length) process.exitCode = 1;
}).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
