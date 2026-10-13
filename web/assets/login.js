"use strict";
let csrf;
let sessionRequest;
const form = document.querySelector("#login-form");
const message = document.querySelector("#login-message");
const button = document.querySelector("#login-button");
async function session() {
    const response = await fetch("/api/admin/session", { cache: "no-store" });
    if (!response.ok)
        throw new Error("El panel no está disponible temporalmente");
    const data = await response.json();
    if (data.authenticated) {
        location.assign("/admin");
        return;
    }
    csrf = data.csrf;
}
function ensureSession() {
    return (sessionRequest ||= session().finally(() => {
        sessionRequest = undefined;
    }));
}
ensureSession()
    .catch((error) => {
        message.textContent = error.message;
    })
    .finally(() => {
        button.disabled = false;
    });
form.addEventListener("submit", async (event) => {
    event.preventDefault();
    button.disabled = true;
    message.textContent = "Comprobando acceso…";
    try {
        if (!csrf) await ensureSession();
        const response = await fetch("/api/admin/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-CSRF-Token": csrf,
            },
            body: JSON.stringify({ password: form.elements.password.value }),
        });
        const data = await response.json();
        if (!response.ok)
            throw new Error(data.error || "No se pudo iniciar sesión");
        form.reset();
        location.assign("/admin");
    } catch (error) {
        message.textContent = error.message;
        button.disabled = false;
    }
});
