export class RateLimiter {
    constructor(config = {}) {
        this.config = {
            perUser: config.perUser || { windowMs: 10000, limit: 8 },
            perGroup: config.perGroup || { windowMs: 10000, limit: 20 },
            perCommand: config.perCommand || { windowMs: 10000, limit: 5 }
        };
        this.counters = new Map();
    }

    hit(key, { windowMs, limit }) {
        const now = Date.now();
        const entry = this.counters.get(key) || { count: 0, resetAt: now + windowMs };
        if (entry.resetAt <= now) {
            entry.count = 0;
            entry.resetAt = now + windowMs;
        }
        entry.count += 1;
        this.counters.set(key, entry);
        return { allowed: entry.count <= limit, remaining: Math.max(0, limit - entry.count), resetAt: entry.resetAt };
    }

    check(context = {}) {
        const results = [];
        if (context.userId) {
            results.push(this.hit(`user:${context.userId}`, this.config.perUser));
        }
        if (context.chatId) {
            results.push(this.hit(`group:${context.chatId}`, this.config.perGroup));
        }
        if (context.command) {
            results.push(this.hit(`command:${context.command}:${context.userId || 'anon'}`, this.config.perCommand));
        }
        return results.every(result => result.allowed);
    }
}

export class AntiSpamEngine {
    constructor(config = {}) {
        this.floodWindowMs = config.floodWindowMs ?? 7000;
        this.floodThreshold = config.floodThreshold ?? 6;
        this.cooldownMs = config.cooldownMs ?? 15000;
        this.autoMuteMs = config.autoMuteMs ?? 60000;
        this.events = new Map();
        this.mutedUntil = new Map();
    }

    evaluate(context = {}) {
        const key = context.userId || context.chatId;
        const now = Date.now();
        const mutedUntil = this.mutedUntil.get(key) || 0;
        if (mutedUntil > now) {
            return { blocked: true, reason: 'muted', mutedUntil };
        }

        const history = (this.events.get(key) || []).filter(timestamp => now - timestamp <= this.floodWindowMs);
        history.push(now);
        this.events.set(key, history);

        if (history.length >= this.floodThreshold) {
            this.mutedUntil.set(key, now + this.autoMuteMs);
            return { blocked: true, reason: 'flood', mutedUntil: now + this.autoMuteMs };
        }

        return { blocked: false, cooldownUntil: now + this.cooldownMs };
    }
}

export default { RateLimiter, AntiSpamEngine };
