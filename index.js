const cron = require("node-cron");
const scrapeAndSendEmails = require("./scrapeAndSendEmails");
const cronitor = require("cronitor")(process.env.CRONITOR_API_KEY);

cron.schedule("0 8 * * 1", () => {
    cronitor.wrap("scrapeAndSendEmails", function () {
        console.log(
            "Ejecutando scrape y envío de correos electrónicos con monitoreo!"
        );
        scrapeAndSendEmails();
    });
});
