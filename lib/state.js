const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const lockfile = require('proper-lockfile');
const { Redis } = require('@upstash/redis');

const EMPTY = () => ({ version: 1, events: {} });

class BusyError extends Error {
    constructor() { super('Ya hay una sincronización en curso'); }
}

function validateState(state) {
    if (!state || state.version !== 1 || !state.events || typeof state.events !== 'object' || Array.isArray(state.events)) {
        throw new Error('El estado guardado no es válido; no se sobrescribirá');
    }
    return state;
}

class FileStore {
    constructor(file) { this.file = file; }
    async withLock(fn) {
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        let compromised;
        let release;
        try {
            release = await lockfile.lock(this.file, { realpath: false, stale: 600000, update: 10000, onCompromised: error => { compromised = error; } });
        } catch (error) {
            if (error.code === 'ELOCKED') throw new BusyError();
            throw error;
        }
        const assert = async () => { if (compromised) throw new Error('Se perdió el bloqueo de la sincronización'); };
        try { return await fn(assert); } finally { await release(); }
    }
    async read() {
        try { return validateState(JSON.parse(await fs.readFile(this.file, 'utf8'))); }
        catch (error) { if (error.code === 'ENOENT') return EMPTY(); throw error; }
    }
    async write(state) {
        validateState(state);
        const temporary = `${this.file}.${randomUUID()}.tmp`;
        try {
            await fs.writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
            await fs.rename(temporary, this.file);
        } finally { await fs.rm(temporary, { force: true }); }
    }
}

class RedisStore {
    constructor(redis, key) { this.redis = redis; this.key = key; }
    async withLock(fn) {
        const token = randomUUID();
        const key = `${this.key}:lock`;
        if (!(await this.redis.set(key, token, { nx: true, ex: 600 }))) throw new BusyError();
        const assert = async () => {
            if (await this.redis.get(key) !== token) throw new Error('Se perdió el bloqueo de la sincronización');
        };
        try { return await fn(assert); }
        finally { await this.redis.eval('if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end', [key], [token]); }
    }
    async read() { return validateState(await this.redis.get(this.key) || EMPTY()); }
    async write(state) { await this.redis.set(this.key, validateState(state)); }
}

function createStore(config) {
    if (config.redisUrl && config.redisToken) return new RedisStore(new Redis({ url: config.redisUrl, token: config.redisToken, retry: { retries: 2, backoff: n => Math.min(500 * 2 ** n, 2000) } }), config.stateKey);
    if (config.redisUrl || config.redisToken) throw new Error('Configura las dos variables de Upstash Redis');
    if (config.isVercel) throw new Error('El estado en Vercel requiere Upstash Redis');
    return new FileStore(config.stateFile);
}

module.exports = { FileStore, RedisStore, BusyError, createStore };
