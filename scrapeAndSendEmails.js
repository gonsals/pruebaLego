// Punto de entrada compatible con el proyecto anterior.
const { loadEnvironment, getConfig } = require('./lib/config');
const { runScan } = require('./lib/scan');

module.exports = async function scrapeAndSendEmails(options = {}) {
    loadEnvironment();
    return runScan(getConfig(), options);
};
