const fs = require("node:fs/promises");
const { randomBytes } = require("node:crypto");
const { passwordHash } = require("../lib/admin");

async function main() {
    const file = ".env.local";
    let content;
    try {
        content = await fs.readFile(file, "utf8");
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
        content = "";
    }
    if (
        /^ADMIN_PASSWORD_HASH=.+$/m.test(content) &&
        !process.argv.includes("--rotate")
    )
        throw new Error(
            "Ya hay un acceso configurado. Usa --rotate para cambiarlo y cerrar las sesiones anteriores.",
        );
    const password = randomBytes(18).toString("base64url");
    const values = {
        ADMIN_PASSWORD_HASH: await passwordHash(password),
        SESSION_SECRET: randomBytes(48).toString("hex"),
    };
    for (const [key, value] of Object.entries(values)) {
        const pattern = new RegExp(`^${key}=.*$`, "m");
        content = pattern.test(content)
            ? content.replace(pattern, `${key}=${value}`)
            : `${content.trimEnd()}\n${key}=${value}\n`;
    }
    await fs.mkdir(".data", { recursive: true });
    await fs.writeFile(
        ".data/admin-access.txt",
        `Brick Radar — acceso privado\nPanel: /login\nContraseña: ${password}\n\nLa contraseña es independiente de Google. No compartas este archivo ni lo publiques.\nPara rotarla: npm run admin:setup -- --rotate y actualiza las dos variables en Vercel.\n`,
        { mode: 0o600 },
    );
    await fs.writeFile(file, content, { mode: 0o600 });
    console.log(
        "Acceso generado. Contraseña en .data/admin-access.txt; hash y secreto de sesión en .env.local. Configura ADMIN_PASSWORD_HASH y SESSION_SECRET también en Vercel.",
    );
}
main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
