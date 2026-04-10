class TTLMap {
    constructor() {
        this.data = new Map();
    }

    set(key, value, ttlMs) {
        const expiresAt = ttlMs ? Date.now() + ttlMs : null;
        this.data.set(key, { value, expiresAt });
    }

    get(key) {
        const entry = this.data.get(key);
        if (!entry) {
            return undefined;
        }

        if (entry.expiresAt && entry.expiresAt <= Date.now()) {
            this.data.delete(key);
            return undefined;
        }

        return entry.value;
    }

    delete(key) {
        this.data.delete(key);
    }
}

export class MemoryStoreAdapter {
    constructor() {
        this.map = new TTLMap();
    }

    async get(key) {
        return this.map.get(key);
    }

    async set(key, value, ttlMs) {
        this.map.set(key, value, ttlMs);
        return value;
    }

    async delete(key) {
        this.map.delete(key);
    }
}

export class RedisStoreAdapter {
    constructor(client) {
        this.client = client;
    }

    async get(key) {
        const value = await this.client.get(key);
        return value ? JSON.parse(value) : undefined;
    }

    async set(key, value, ttlMs) {
        const payload = JSON.stringify(value);
        if (ttlMs) {
            await this.client.set(key, payload, { PX: ttlMs });
            return value;
        }
        await this.client.set(key, payload);
        return value;
    }

    async delete(key) {
        await this.client.del(key);
    }
}

export class MongoStoreAdapter {
    constructor(collection) {
        this.collection = collection;
    }

    async get(key) {
        const doc = await this.collection.findOne({ _id: key, $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] });
        return doc?.value;
    }

    async set(key, value, ttlMs) {
        const expiresAt = ttlMs ? new Date(Date.now() + ttlMs) : null;
        await this.collection.updateOne({ _id: key }, { $set: { value, expiresAt } }, { upsert: true });
        return value;
    }

    async delete(key) {
        await this.collection.deleteOne({ _id: key });
    }
}

export class StoreSystem {
    constructor(adapter = new MemoryStoreAdapter()) {
        this.adapter = adapter;
    }

    key(namespace, id) {
        return `${namespace}:${id}`;
    }

    async get(namespace, id) {
        return this.adapter.get(this.key(namespace, id));
    }

    async set(namespace, id, value, ttlMs) {
        return this.adapter.set(this.key(namespace, id), value, ttlMs);
    }

    async delete(namespace, id) {
        return this.adapter.delete(this.key(namespace, id));
    }
}

export default StoreSystem;
