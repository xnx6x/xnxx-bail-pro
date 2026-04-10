export class SessionSystem {
    constructor(factory) {
        this.factory = factory;
        this.sessions = new Map();
    }

    async createSession(id, config) {
        if (this.sessions.has(id)) {
            throw new Error(`Session already exists: ${id}`);
        }

        const session = await this.factory(config);
        this.sessions.set(id, session);
        return session;
    }

    getSession(id) {
        return this.sessions.get(id);
    }

    listSessions() {
        return Array.from(this.sessions.keys());
    }

    async closeSession(id) {
        const session = this.sessions.get(id);
        if (!session) {
            return false;
        }

        try {
            session.ws?.close?.();
            session.end?.();
        } finally {
            this.sessions.delete(id);
        }

        return true;
    }
}

export default SessionSystem;
