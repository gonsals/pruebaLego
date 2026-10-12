const { setTimeout: delay } = require('node:timers/promises');

class HttpError extends Error {
    constructor(service, status) {
        super(`${service}: respuesta HTTP ${status}`);
        this.status = status;
    }
}

async function request(url, options = {}, { service = 'Servicio externo', retries = 2, fetchImpl = fetch } = {}) {
    for (let attempt = 0; ; attempt++) {
        try {
            const signal = options.signal
                ? AbortSignal.any([options.signal, AbortSignal.timeout(12000)])
                : AbortSignal.timeout(12000);
            const response = await fetchImpl(url, { ...options, signal });
            if (!response.ok) throw new HttpError(service, response.status);
            return response;
        } catch (error) {
            if (options.signal?.aborted) throw new Error('Tiempo máximo de ejecución agotado');
            const retryable = error.status === undefined || error.status === 429 || error.status >= 500;
            if (!retryable || attempt >= retries) {
                if (error instanceof HttpError) throw error;
                throw new Error(`${service}: no se pudo completar la petición`, { cause: error });
            }
            await delay(250 * 2 ** attempt, undefined, { signal: options.signal });
        }
    }
}

module.exports = { request, HttpError };
