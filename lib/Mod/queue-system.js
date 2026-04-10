class QueueLane {
    constructor({ concurrency = 1, minIntervalMs = 0 } = {}) {
        this.concurrency = concurrency;
        this.minIntervalMs = minIntervalMs;
        this.active = 0;
        this.lastRunAt = 0;
        this.pending = [];
    }

    enqueue(task) {
        return new Promise((resolve, reject) => {
            this.pending.push({ task, resolve, reject });
            this.flush();
        });
    }

    flush() {
        if (this.active >= this.concurrency || this.pending.length === 0) {
            return;
        }

        const waitTime = Math.max(0, this.minIntervalMs - (Date.now() - this.lastRunAt));
        if (waitTime > 0) {
            setTimeout(() => this.flush(), waitTime);
            return;
        }

        const next = this.pending.shift();
        if (!next) {
            return;
        }

        this.active += 1;
        this.lastRunAt = Date.now();

        Promise.resolve()
            .then(next.task)
            .then(next.resolve, next.reject)
            .finally(() => {
                this.active -= 1;
                this.flush();
            });
    }
}

export class QueueSystem {
    constructor(config = {}) {
        this.globalLane = new QueueLane(config.global || { concurrency: 1, minIntervalMs: 0 });
        this.userLanes = new Map();
        this.groupLanes = new Map();
        this.userConfig = config.user || { concurrency: 1, minIntervalMs: 250 };
        this.groupConfig = config.group || { concurrency: 1, minIntervalMs: 150 };
    }

    getLane(scope, key) {
        if (scope === 'global') {
            return this.globalLane;
        }

        const targetMap = scope === 'group' ? this.groupLanes : this.userLanes;
        const laneConfig = scope === 'group' ? this.groupConfig : this.userConfig;
        if (!targetMap.has(key)) {
            targetMap.set(key, new QueueLane(laneConfig));
        }
        return targetMap.get(key);
    }

    async schedule({ scope = 'global', key = 'global', task }) {
        const lane = this.getLane(scope, key);
        return lane.enqueue(() => this.globalLane.enqueue(task));
    }

    async scheduleMessage(meta, task) {
        if (meta?.isGroup) {
            return this.schedule({ scope: 'group', key: meta.chatId, task });
        }

        if (meta?.userId) {
            return this.schedule({ scope: 'user', key: meta.userId, task });
        }

        return this.schedule({ scope: 'global', key: 'global', task });
    }
}

export default QueueSystem;
