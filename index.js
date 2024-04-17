const axios = require("axios");
const cheerio = require("cheerio");
const nodemailer = require("nodemailer");

async function scrapeWebsite(url) {
    try {
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);
        const events = [];

        $("li").each((index, element) => {
            const h3Text = $(element).find("h3").text();
            const pText = $(element).find("p").text();

            if (h3Text.includes("casa")) {
                // Divide el texto del pText en eventos individuales
                const eventDetails = pText.match(
                    /\d{1,2}\/\d{1,2} - De \d{1,2}:\d{2} a \d{1,2}:\d{2}/g
                );

                // Agrega cada evento a la lista de eventos
                eventDetails.forEach((eventDetail) => {
                    events.push({ text: h3Text, time: eventDetail });
                });
            }
        });

        if (events.length > 0) {
            sendEmail(events);
        }
    } catch (error) {
        console.error("Error scraping website:", error);
    }
}

async function sendEmail(events) {
    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: "legoeventosnotification@gmail.com",
            pass: "ppwrkgzxtmzofipl",
        },
    });

    let emailContent = "<h1>Eventos encontrados:</h1>";

    events.forEach((event, index) => {
        // Genera un enlace para agregar el evento al calendario de Google
        const googleCalendarLink = generateGoogleCalendarLink(event);

        // Agrega el evento al contenido del correo electrónico
        emailContent += `<p><strong>${event.text}</strong><br>${event.time} <a href="${googleCalendarLink}">(Agregar al calendario)</a></p>`;
    });

    const mailOptions = {
        from: "legoeventosnotification@gmail.com",
        to: "mariablade2000@gmail.com",
        subject: "Eventos encontrados",
        html: emailContent,
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error("Error al enviar el correo electrónico:", error);
        } else {
            console.log("Correo electrónico enviado:", info.messageId);
        }
    });
}

function generateGoogleCalendarLink(event) {
    const startDate = formatDate(parseEventTime(event.time)[0]);
    const endDate = formatDate(parseEventTime(event.time)[1]);

    if (!startDate || !endDate) {
        return null;
    }

    return `https://www.google.com/calendar/event?action=TEMPLATE&dates=${startDate}/${endDate}&text=${encodeURIComponent(
        event.text
    )}&details=${encodeURIComponent(event.text)} el ${encodeURIComponent(
        event.time
    )}`;
}

function parseEventTime(timeString) {
    const regex = /(\d{1,2}\/\d{1,2}) - De (\d{1,2}:\d{2}) a (\d{1,2}:\d{2})/g;
    const matches = timeString.match(regex);
    console.log(matches);
    if (!matches) {
        return [null, null];
    }

    const startDateParts = matches[0].split(" - ")[0].split("/");
    const startTimeParts = matches[0]
        .split(" De ")[1]
        .split(" a ")[0]
        .split(":");
    const endTimeParts = matches[0].split(" - ")[1].split(" a ")[1].split(":");

    const startDate = new Date();
    startDate.setMonth(parseInt(startDateParts[1]) - 1);
    startDate.setDate(parseInt(startDateParts[0]));
    startDate.setHours(parseInt(startTimeParts[0]));
    startDate.setMinutes(parseInt(startTimeParts[1]));

    const endDate = new Date();
    endDate.setMonth(parseInt(startDateParts[1]) - 1);
    endDate.setDate(parseInt(startDateParts[0]));
    endDate.setHours(parseInt(endTimeParts[0]));
    endDate.setMinutes(parseInt(endTimeParts[1]));

    return [startDate, endDate];
}

function formatDate(date) {
    if (!date) {
        return null;
    }

    const year = date.getFullYear();
    let month = date.getMonth() + 1;
    let day = date.getDate();
    let hours = date.getHours();
    let minutes = date.getMinutes();

    if (month < 10) {
        month = `0${month}`;
    }
    if (day < 10) {
        day = `0${day}`;
    }
    if (hours < 10) {
        hours = `0${hours}`;
    }
    if (minutes < 10) {
        minutes = `0${minutes}`;
    }

    return `${year}${month}${day}T${hours}${minutes}00`;
}

scrapeWebsite("https://www.lego.com/es-es/stores/store/barcelona");
