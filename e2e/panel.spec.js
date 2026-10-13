const { test, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
test("Enviar mientras se prepara la sesión espera una única petición y permite acceder", async ({
    page,
}) => {
    let requests = 0;
    await page.route("**/api/admin/session", async (route) => {
        requests++;
        await new Promise((resolve) => setTimeout(resolve, 400));
        await route.continue();
    });
    await page.goto("/login");
    await page.getByLabel("Contraseña", { exact: true }).fill("demo-password");
    await expect(page.locator("#login-button")).toBeDisabled();
    await page.locator("#login-form").evaluate((form) => form.requestSubmit());
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.locator("#stat-sessions")).toHaveText("1");
    // El panel solicita otra sesión tras navegar; el acceso no duplica la inicial.
    expect(requests).toBe(2);
});
async function login(page) {
    await page.goto("/login");
    await page.getByLabel("Contraseña", { exact: true }).fill("demo-password");
    await page.getByRole("button", { name: "Entrar al panel" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.locator("#stat-sessions")).toHaveText("1");
}
test("Portada, acceso, destinatarios persistentes, actualización y calendario funcionan desde el navegador", async ({
    page,
    context,
}) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await fs.mkdir(".data/qa", { recursive: true });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
        "Gratis",
    );
    await page.screenshot({
        path: ".data/qa/landing-desktop.png",
        fullPage: true,
    });
    await login(page);
    await page.getByLabel("Nuevo destinatario").fill("friend@example.com");
    await page.getByRole("button", { name: "Añadir destinatario" }).click();
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.locator("#notice")).toContainText(
        "Preferencias guardadas",
    );
    await page.reload();
    await expect(page.locator("#stat-recipients")).toHaveText("2");
    await expect(
        page.getByLabel("friend@example.com", { exact: true }),
    ).toBeChecked();
    await page.getByRole("button", { name: "Actualizar LEGO" }).click();
    await expect(page.locator("#notice")).toContainText("Consulta completada");
    await expect(page.locator("#stat-source")).toHaveText("Correcta");
    await expect(page.locator("#activity-list")).toContainText(
        "Consulta manual de LEGO",
    );
    await page.locator(".day.has-event").first().click();
    await expect(page.locator("#calendar-selected")).toContainText(
        "Construye tu próximo modelo",
    );
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: "Copiar URL privada" }).click();
    await expect(page.locator("#notice")).toContainText("URL privada copiada");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(
        /\/calendar\/demo.*\.ics$/,
    );
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({
        path: ".data/qa/panel-desktop.png",
        fullPage: true,
    });
    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(errors).toEqual([]);
});
test("El panel se puede usar en móvil y no desborda horizontalmente", async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
        ),
    ).toBe(true);
    await page
        .getByRole("link", { name: "Destinatarios", exact: true })
        .click();
    await expect(
        page.getByRole("button", { name: "Guardar cambios" }),
    ).toBeVisible();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({
        path: ".data/qa/panel-mobile.png",
        fullPage: true,
    });
});
