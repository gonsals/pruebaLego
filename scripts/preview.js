const fs = require('node:fs/promises');
const path = require('node:path');
const { loadEnvironment, getConfig } = require('../lib/config');
const { runScan } = require('../lib/scan');
const { buildMail } = require('../lib/email');

async function preview() {
    loadEnvironment();
    const result = await runScan(getConfig(), { dryRun: true });
    const directory = path.resolve('.data/preview');
    await fs.mkdir(directory, { recursive: true });
    for (const event of result.events) {
        const mail = buildMail(event, { to: [], from: '', fingerprint: event.fingerprint });
        const name = `${event.store.slug}-${event.urlKey}`;
        const htmlPath = path.join(directory, `${name}.html`);
        await fs.writeFile(htmlPath, mail.html);
        console.log(htmlPath);
        for (const attachment of mail.attachments) {
            const icsPath = path.join(directory, `${name}.ics`);
            await fs.writeFile(icsPath, attachment.content);
            console.log(icsPath);
        }
    }
    if (!result.events.length) console.log('No hay construcciones gratuitas confirmadas para previsualizar');
    if (result.failures.length) throw new Error('La consulta de LEGO tuvo errores; ejecuta npm run scan para ver el detalle');
}

preview().catch(error => { console.error(error.message); process.exitCode = 1; });
