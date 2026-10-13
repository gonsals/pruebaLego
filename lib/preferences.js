const EMAIL = /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/;

function defaultPreferences(config) {
    return {
        revision: 0,
        emailEnabled: config.emailEnabled,
        recipients: config.email.to.map((address) => ({
            address: address.toLowerCase(),
            enabled: true,
        })),
    };
}

function preferences(state, config) {
    return state.preferences || defaultPreferences(config);
}

function validatePreferences(input) {
    if (
        !input ||
        typeof input.emailEnabled !== "boolean" ||
        !Array.isArray(input.recipients) ||
        input.recipients.length > 50
    )
        throw new Error("Indica hasta 50 destinatarios y el estado del envío");
    const recipients = input.recipients.map((recipient) => {
        if (
            typeof recipient?.address !== "string" ||
            typeof recipient.enabled !== "boolean"
        )
            throw new Error("Destinatario no válido");
        const address = recipient.address.trim().toLowerCase();
        if (address.length > 254 || !EMAIL.test(address))
            throw new Error("Hay una dirección de correo no válida");
        return { address, enabled: recipient.enabled };
    });
    if (new Set(recipients.map((r) => r.address)).size !== recipients.length)
        throw new Error("Hay direcciones repetidas");
    if (input.emailEnabled && !recipients.some((r) => r.enabled))
        throw new Error(
            "Añade un destinatario activo antes de activar los avisos",
        );
    return { emailEnabled: input.emailEnabled, recipients };
}

function effectiveConfig(config, state) {
    const settings = preferences(state, config);
    const to = settings.recipients
        .filter((r) => r.enabled)
        .map((r) => r.address);
    return {
        ...config,
        emailEnabled: settings.emailEnabled && to.length > 0,
        email: { ...config.email, to },
    };
}

function activity(state, entry) {
    state.activity = [
        { at: new Date().toISOString(), ...entry },
        ...(state.activity || []),
    ].slice(0, 50);
}

module.exports = {
    preferences,
    validatePreferences,
    effectiveConfig,
    activity,
};
