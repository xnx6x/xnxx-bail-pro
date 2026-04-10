import makeWASocket from '../Socket/index.js';
import QueueSystem from './queue-system.js';
import RetryEngine from './retry-engine.js';
import StoreSystem, { MemoryStoreAdapter, MongoStoreAdapter, RedisStoreAdapter } from './store-system.js';
import PermissionSystem from './permissions.js';
import { RateLimiter, AntiSpamEngine } from './control-system.js';
import AnalyticsSystem from './analytics-system.js';
import RuleEngine from './rule-engine.js';
import SessionSystem from './session-system.js';
import UISystem from './ui-system.js';
import GameSystem from './game-system.js';
import { CommandRegistry, CommandRuntime, CooldownManager, extractActionId, extractMessageText } from './command-system.js';
import MenuSystem from './menu-system.js';
import PluginManager from './plugin-system.js';
import { createCorePlugin, createModerationPlugin } from './starter-plugins.js';

const jidMeta = (jid = '') => ({
    chatId: jid,
    isGroup: jid.endsWith('@g.us'),
    userId: jid.endsWith('@g.us') ? jid : jid.split('@')[0]
});

const safeJsonParse = (value) => {
    if (!value || typeof value !== 'string') {
        return null;
    }
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
};

const createBaseContext = (sock, mod, message) => {
    const remoteJid = message.key?.remoteJid;
    const participant = message.key?.participant || remoteJid;
    const text = extractMessageText(message);
    const actionId = extractActionId(message);
    const parsedNativeFlow = safeJsonParse(actionId);
    const normalizedActionId = parsedNativeFlow?.id || actionId;

    return {
        ...jidMeta(remoteJid),
        userId: participant?.split('@')[0],
        participant,
        message,
        text,
        actionId: normalizedActionId,
        rawActionPayload: parsedNativeFlow,
        args: [],
        reply: (textOrContent, options = {}) => mod.sendQueued(remoteJid, typeof textOrContent === 'string' ? { text: textOrContent } : textOrContent, options),
        warn: (text, options = {}) => mod.sendQueued(remoteJid, { text }, options),
        deleteMessage: () => sock.sendMessage(remoteJid, { delete: message.key }),
        forward: (targetJid) => sock.sendMessage(targetJid, { forward: message }),
        mute: async (durationMs) => mod.store.set('mute', participant, { until: Date.now() + durationMs }, durationMs)
    };
};

export const createModFramework = (sock, config = {}) => {
    const store = new StoreSystem(config.storeAdapter || new MemoryStoreAdapter());
    const queue = new QueueSystem(config.queue);
    const retry = new RetryEngine(config.retry);
    const permissions = new PermissionSystem(config.permissions);
    const rateLimiter = new RateLimiter(config.rateLimiter);
    const antiSpam = new AntiSpamEngine(config.antiSpam);
    const analytics = new AnalyticsSystem();
    const rules = new RuleEngine(config.rules || []);
    const ui = new UISystem();
    const games = new GameSystem(store);
    const commands = new CommandRegistry();
    const cooldowns = new CooldownManager();
    const menus = new MenuSystem(store);
    const runtime = new CommandRuntime({ registry: commands, permissions, cooldowns });
    const plugins = new PluginManager({ commands, rules, permissions });
    const prefix = config.prefix || '.';

    const mod = {
        prefix,
        store,
        queue,
        retry,
        permissions,
        rateLimiter,
        antiSpam,
        analytics,
        rules,
        ui,
        games,
        commands,
        cooldowns,
        menus,
        plugins,
        async sendQueued(jid, content, options = {}) {
            const meta = jidMeta(jid);
            return queue.scheduleMessage(meta, async () => retry.sendWithRetry(
                (payload) => sock.sendMessage(jid, payload, options),
                content
            ));
        },
        async sendButtons(jid, payload, options = {}) {
            return mod.sendQueued(jid, ui.buildButtonsMessage(payload), options);
        },
        async sendList(jid, payload, options = {}) {
            return mod.sendQueued(jid, ui.buildListMessage(payload), options);
        },
        async sendHybridCarousel(jid, payload, options = {}) {
            return mod.sendQueued(jid, ui.buildHybridCarousel(payload), options);
        },
        async sendFlowStep(jid, flow, state, options = {}) {
            return mod.sendQueued(jid, ui.buildFlowStep(flow, state), options);
        },
        async sendProgressUpdate(jid, payload, editKey, options = {}) {
            return mod.sendQueued(jid, { ...ui.buildProgressUpdate(payload), edit: editKey }, options);
        },
        registerCommand(command) {
            return commands.register(command);
        },
        use(plugin) {
            return plugins.use(plugin);
        },
        createContext(message) {
            return createBaseContext(sock, mod, message);
        }
    };

    if (config.loadStarterPlugins !== false) {
        mod.use(createCorePlugin(mod));
        mod.use(createModerationPlugin(mod));
    }

    sock.mod = mod;

    sock.ev.on('messages.upsert', ({ messages }) => {
        for (const message of messages || []) {
            const remoteJid = message.key?.remoteJid;
            const participant = message.key?.participant || message.key?.remoteJid;
            if (!remoteJid || message.key?.fromMe) {
                continue;
            }

            const ctx = createBaseContext(sock, mod, message);
            analytics.trackMessage({ userId: ctx.userId, chatId: ctx.chatId, timestamp: Date.now() });

            Promise.resolve(store.get('mute', participant))
                .then(async (muteState) => {
                    if (muteState?.until && muteState.until > Date.now()) {
                        return;
                    }

                    const parsedCommand = runtime.parse({ text: ctx.text, prefix });
                    const commandName = parsedCommand?.name || ctx.actionId || ctx.text.split(/\s+/)[0];

                    if (!rateLimiter.check({ userId: ctx.userId, chatId: ctx.chatId, command: commandName })) {
                        return;
                    }

                    const spamState = antiSpam.evaluate(ctx);
                    if (spamState.blocked) {
                        await ctx.warn(`Slow down. Anti-spam triggered: ${spamState.reason}`);
                        return;
                    }

                    const menuAction = await menus.resolve(ctx.chatId, ctx.actionId);
                    if (menuAction?.item?.command) {
                        const menuCommand = runtime.parse({ text: `${prefix}${menuAction.item.command}`, prefix });
                        if (menuCommand) {
                            await runtime.execute(menuCommand, ctx);
                            return;
                        }
                    }

                    if (parsedCommand) {
                        const result = await runtime.execute(parsedCommand, ctx);
                        if (result.handled) {
                            return;
                        }
                    }

                    await rules.run(ctx);
                })
                .catch(error => sock.logger?.warn?.({ error }, 'mod framework processing failed'));
        }
    });

    return mod;
};

export const makeModularWASocket = (config = {}, modConfig = {}) => {
    const sock = makeWASocket(config);
    createModFramework(sock, modConfig);
    return sock;
};

export {
    AnalyticsSystem,
    AntiSpamEngine,
    CommandRegistry,
    CommandRuntime,
    CooldownManager,
    GameSystem,
    MemoryStoreAdapter,
    MenuSystem,
    MongoStoreAdapter,
    PermissionSystem,
    PluginManager,
    QueueSystem,
    RateLimiter,
    RedisStoreAdapter,
    RetryEngine,
    RuleEngine,
    SessionSystem,
    StoreSystem,
    UISystem,
    createCorePlugin,
    createModerationPlugin,
    extractActionId,
    extractMessageText
};

export const createSessionManager = () => new SessionSystem((sessionConfig) => makeModularWASocket(sessionConfig.config, sessionConfig.modConfig));

export default makeModularWASocket;
