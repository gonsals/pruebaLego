const express = require("express");
const scrapeAndSendEmails = require("./scrapeAndSendEmails");

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/sendLego", async (req, res) => {
    try {
        // await scrapeAndSendEmails();
        console.log("prueba1");
        res.status(200).send("scrapeAndSendEmails() llamado correctamente");
    } catch (error) {
        console.error("Error al llamar a scrapeAndSendEmails():", error);
        res.status(500).send("Error al llamar a scrapeAndSendEmails()");
    }
});

// Inicia el servidor
app.listen(PORT, () => {
    console.log(`Servidor Express escuchando en el puerto ${PORT}`);
});
