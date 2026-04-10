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

const jidMeta = (jid = '') => ({
    chatId: jid,
    isGroup: jid.endsWith('@g.us'),
    userId: jid.endsWith('@g.us') ? jid : jid.split('@')[0]
});

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

    const mod = {
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
        }
    };

    sock.mod = mod;

    sock.ev.on('messages.upsert', ({ messages }) => {
        for (const message of messages || []) {
            const remoteJid = message.key?.remoteJid;
            const participant = message.key?.participant || message.key?.remoteJid;
            if (!remoteJid || message.key?.fromMe) {
                continue;
            }

            const ctx = {
                ...jidMeta(remoteJid),
                userId: participant?.split('@')[0],
                message,
                text: message.message?.conversation
                    || message.message?.extendedTextMessage?.text
                    || message.message?.imageMessage?.caption
                    || message.message?.videoMessage?.caption
                    || '',
                reply: (text) => mod.sendQueued(remoteJid, { text }),
                warn: (text) => mod.sendQueued(remoteJid, { text }),
                deleteMessage: () => sock.sendMessage(remoteJid, { delete: message.key }),
                forward: (targetJid) => sock.sendMessage(targetJid, { forward: message }),
                mute: async (durationMs) => store.set('mute', participant, { until: Date.now() + durationMs }, durationMs)
            };

            analytics.trackMessage({ userId: ctx.userId, chatId: ctx.chatId, timestamp: Date.now() });

            const muteStatePromise = store.get('mute', participant);
            Promise.resolve(muteStatePromise)
                .then(async (muteState) => {
                    if (muteState?.until && muteState.until > Date.now()) {
                        return;
                    }

                    if (!rateLimiter.check({ userId: ctx.userId, chatId: ctx.chatId, command: ctx.text.split(/\s+/)[0] })) {
                        return;
                    }

                    const spamState = antiSpam.evaluate(ctx);
                    if (spamState.blocked) {
                        await ctx.warn(`Slow down. Anti-spam triggered: ${spamState.reason}`);
                        return;
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
    GameSystem,
    MemoryStoreAdapter,
    MongoStoreAdapter,
    PermissionSystem,
    QueueSystem,
    RateLimiter,
    RedisStoreAdapter,
    RetryEngine,
    RuleEngine,
    SessionSystem,
    StoreSystem,
    UISystem
};

export const createSessionManager = () => new SessionSystem((sessionConfig) => makeModularWASocket(sessionConfig.config, sessionConfig.modConfig));

export default makeModularWASocket;
