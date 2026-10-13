const { test, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
test("La portada muestra los eventos reales sin acceso y enlaces oficiales y de calendario", async ({
    page,
    context,
}) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await expect(page.locator(".public-event")).toHaveCount(1);
    await expect(page.locator(".public-event h3")).toContainText(
        "Construye tu próximo modelo gratis",
    );
    await expect(page.locator(".public-session a")).toHaveAttribute(
        "href",
        /^https:\/\/calendar.google.com\/calendar\/render/,
    );
    await expect(page.locator(".official-event")).toHaveAttribute(
        "href",
        "https://www.lego.com/es-es/stores/store/barcelona",
    );
    await page.getByText("Ver condiciones del evento", { exact: true }).click();
    await expect(page.locator(".public-conditions p")).toBeVisible();
    await expect(page.locator("#next-plan strong")).toContainText(
        "Construye tu próximo modelo",
    );
    await expect(page.locator('.next-plan-icon')).toHaveText('▦');
    await expect(page.locator('#next-plan > div > span')).toContainText('LEGO Store Barcelona');
    await expect(
        page.getByText("VISTA DE EJEMPLO", { exact: true }),
    ).toBeVisible();
    expect(await context.cookies()).toEqual([]);
    await fs.mkdir(".data/qa", { recursive: true });
    await page.screenshot({
        path: ".data/qa/lego-landing-desktop.png",
        fullPage: true,
    });
    expect(errors).toEqual([]);
});
test("Portada móvil sin desbordamiento y navegación a próximos eventos", async ({
    page,
}) => {
    for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        await page.goto("/");
        await expect(page.locator(".public-event")).toHaveCount(1);
        expect(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
            ),
        ).toBe(true);
        await page.getByRole("link", { name: "Ver próximos eventos" }).click();
        await expect(page).toHaveURL(/#proximos-eventos$/);
        await expect(page.locator("#events-title")).toBeInViewport();
    }
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({
        path: ".data/qa/lego-landing-mobile.png",
        fullPage: true,
    });
});
test("Distingue una lista vacía de un fallo, permite reintentar y conserva las advertencias de fuente", async ({
    page,
}) => {
    let failed = true;
    await page.route("**/api/events", (route) =>
        route.fulfill({
            status: failed ? 503 : 200,
            contentType: "application/json",
            body: JSON.stringify(
                failed
                    ? { error: "No se pueden cargar ahora" }
                    : {
                          events: [],
                          updatedAt: "2026-10-10T08:00:00Z",
                          stale: true,
                          sourceStatus: "incomplete",
                      },
            ),
        }),
    );
    await page.goto("/");
    await expect(page.locator("#public-events")).toContainText(
        "Vamos a necesitar otro intento",
    );
    await expect(page.locator(".public-event")).toHaveCount(0);
    failed = false;
    await page.getByRole("button", { name: "Volver a cargar eventos" }).click();
    await expect(page.locator("#public-events")).toContainText(
        "El siguiente modelo aún está por llegar",
    );
    await expect(page.locator("#public-freshness")).toContainText(
        "Falló la última consulta",
    );
    await expect(page.locator("#retry-events")).toBeHidden();
});
