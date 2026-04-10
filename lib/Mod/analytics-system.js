export class AnalyticsSystem {
    constructor() {
        this.userStats = new Map();
        this.groupStats = new Map();
    }

    bump(map, key, updater) {
        const current = map.get(key) || updater({});
        const next = updater(current);
        map.set(key, next);
        return next;
    }

    trackMessage({ userId, chatId, timestamp = Date.now() }) {
        if (userId) {
            this.bump(this.userStats, userId, (stat) => ({
                messageCount: (stat.messageCount || 0) + 1,
                lastActiveAt: timestamp
            }));
        }

        if (chatId) {
            const hour = new Date(timestamp).getHours();
            this.bump(this.groupStats, chatId, (stat) => ({
                messageCount: (stat.messageCount || 0) + 1,
                activeUsers: new Set([...(stat.activeUsers || []), userId].filter(Boolean)),
                heatmap: { ...(stat.heatmap || {}), [hour]: ((stat.heatmap || {})[hour] || 0) + 1 },
                lastActiveAt: timestamp
            }));
        }
    }

    getUserStats(userId) {
        return this.userStats.get(userId) || { messageCount: 0 };
    }

    getGroupStats(chatId) {
        const stat = this.groupStats.get(chatId);
        if (!stat) {
            return { messageCount: 0, activeUsers: [], heatmap: {} };
        }

        return {
            ...stat,
            activeUsers: Array.from(stat.activeUsers || [])
        };
    }
}

export default AnalyticsSystem;
