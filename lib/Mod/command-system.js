const now = () => Date.now();

const normalizeAliases = (command) => [command.name, ...(command.aliases || [])].filter(Boolean);

export const extractMessageText = (message) =>
    message?.message?.conversation
    || message?.message?.extendedTextMessage?.text
    || message?.message?.imageMessage?.caption
    || message?.message?.videoMessage?.caption
    || '';

export const extractActionId = (message) =>
    message?.message?.buttonsResponseMessage?.selectedButtonId
    || message?.message?.listResponseMessage?.singleSelectReply?.selectedRowId
    || message?.message?.templateButtonReplyMessage?.selectedId
    || message?.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;

export class CommandRegistry {
    constructor() {
        this.commands = new Map();
    }

    register(command) {
        for (const alias of normalizeAliases(command)) {
            this.commands.set(alias.toLowerCase(), command);
        }
        return command;
    }

    get(name) {
        return this.commands.get((name || '').toLowerCase());
    }

    list() {
        return [...new Set([...this.commands.values()])];
    }
}

export class CooldownManager {
    constructor() {
        this.entries = new Map();
    }

    key({ userId, commandName }) {
        return `${userId}:${commandName}`;
    }

    check({ userId, commandName, cooldownMs = 0 }) {
        if (!cooldownMs) {
            return { allowed: true, retryAfterMs: 0 };
        }

        const key = this.key({ userId, commandName });
        const expiresAt = this.entries.get(key) || 0;
        const current = now();
        if (expiresAt > current) {
            return { allowed: false, retryAfterMs: expiresAt - current };
        }

        this.entries.set(key, current + cooldownMs);
        return { allowed: true, retryAfterMs: 0 };
    }
}

export class CommandRuntime {
    constructor({ registry, permissions, cooldowns }) {
        this.registry = registry;
        this.permissions = permissions;
        this.cooldowns = cooldowns;
    }

    parse({ text = '', prefix = '.' }) {
        if (!text.startsWith(prefix)) {
            return null;
        }

        const [rawName, ...args] = text.slice(prefix.length).trim().split(/\s+/).filter(Boolean);
        if (!rawName) {
            return null;
        }

        return {
            name: rawName.toLowerCase(),
            args,
            raw: text
        };
    }

    async execute(input, context) {
        const command = this.registry.get(input.name);
        if (!command) {
            return { handled: false, reason: 'not_found' };
        }

        const allowed = await this.permissions.can(command.permission || 'public.command', {
            ...context,
            command: input.name
        });
        if (!allowed) {
            await context.reply(`Permission denied for ${input.name}`);
            return { handled: true, reason: 'forbidden' };
        }

        const cooldown = this.cooldowns.check({
            userId: context.userId,
            commandName: command.name,
            cooldownMs: command.cooldownMs
        });
        if (!cooldown.allowed) {
            await context.reply(`Cooldown active. Try again in ${Math.ceil(cooldown.retryAfterMs / 1000)}s`);
            return { handled: true, reason: 'cooldown' };
        }

        await command.execute({
            ...context,
            command,
            args: input.args,
            rawText: input.raw
        });

        return { handled: true, reason: 'executed', command };
    }
}

export default {
    CommandRegistry,
    CommandRuntime,
    CooldownManager,
    extractActionId,
    extractMessageText
};
