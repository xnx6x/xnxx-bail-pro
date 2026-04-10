const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export class RetryEngine {
    constructor(config = {}) {
        this.maxRetries = config.maxRetries ?? 3;
        this.baseDelayMs = config.baseDelayMs ?? 750;
        this.maxDelayMs = config.maxDelayMs ?? 10000;
        this.shouldRetry = config.shouldRetry || (() => true);
    }

    getDelay(attempt) {
        return Math.min(this.baseDelayMs * (2 ** Math.max(0, attempt - 1)), this.maxDelayMs);
    }

    async run(task, options = {}) {
        const maxRetries = options.maxRetries ?? this.maxRetries;
        let attempt = 0;
        let lastError;

        while (attempt <= maxRetries) {
            attempt += 1;
            try {
                return await task({ attempt });
            } catch (error) {
                lastError = error;
                if (attempt > maxRetries || !this.shouldRetry(error, attempt, options)) {
                    throw error;
                }
                await wait(this.getDelay(attempt));
            }
        }

        throw lastError;
    }

    async sendWithRetry(sendFn, payload, options = {}) {
        return this.run(() => sendFn(payload), options);
    }

    async mediaReupload(task, options = {}) {
        return this.run(task, { ...options, maxRetries: options.maxRetries ?? Math.max(2, this.maxRetries) });
    }
}

export default RetryEngine;
