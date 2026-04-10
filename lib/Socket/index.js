import { DEFAULT_CONNECTION_CONFIG } from '../Defaults/index.js';
import { makeCommunitiesSocket } from './communities.js';
import { Browsers } from '../Utils/browser-utils.js';
import { DisconnectReason } from '../Types/index.js';
import NexusHandler from './nexus-handler.js';

// export the last socket layer
const makeWASocket = (config = {}) => {
    const newConfig = {
        ...DEFAULT_CONNECTION_CONFIG,
        ...config
    };
    
    // If the user hasn't provided their own history sync function,
    // let's create a default one that respects the syncFullHistory flag.
    if (config.shouldSyncHistoryMessage === undefined) {
        newConfig.shouldSyncHistoryMessage = () => !!newConfig.syncFullHistory;
    }
    
    const sock = makeCommunitiesSocket(newConfig);
    
    // Auto Reconnect Helper - emits 'reconnect.required' event for user to handle
    const autoReconnectConfig = config.autoReconnect || DEFAULT_CONNECTION_CONFIG.autoReconnect;
    let reconnectAttempts = 0;
    
    sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason?.loggedOut && statusCode !== 401;
            
            if (shouldReconnect && autoReconnectConfig?.enabled) {
                reconnectAttempts++;
                const delay = Math.min(
                    autoReconnectConfig.retryDelay * Math.pow(2, reconnectAttempts - 1),
                    autoReconnectConfig.maxRetryDelay
                );
                
                if (reconnectAttempts <= autoReconnectConfig.maxRetries) {
                    sock.logger?.info?.(`Connection closed. Reconnect attempt ${reconnectAttempts}/${autoReconnectConfig.maxRetries} in ${delay}ms`);
                    sock.reconnectInfo = { 
                        attempt: reconnectAttempts, 
                        maxAttempts: autoReconnectConfig.maxRetries,
                        delay,
                        shouldReconnect: true,
                        statusCode
                    };
                } else {
                    sock.logger?.error?.('Max reconnection attempts reached');
                    sock.reconnectInfo = { 
                        attempt: reconnectAttempts, 
                        maxAttempts: autoReconnectConfig.maxRetries,
                        shouldReconnect: false,
                        statusCode
                    };
                }
            } else {
                sock.reconnectInfo = { shouldReconnect: false, statusCode };
            }
        } else if (connection === 'open') {
            reconnectAttempts = 0;
            sock.reconnectInfo = { shouldReconnect: false, connected: true };
        }
    });

    // Anti-Call Feature
    const antiCallConfig = config.antiCall || DEFAULT_CONNECTION_CONFIG.antiCall;
    if (antiCallConfig?.enabled) {
        sock.logger?.info?.('Anti-call feature enabled');

        sock.ev.on('call', async (callData) => {
            for (const call of callData) {
                const callerJid = call.from;
                const callId = call.id;
                const callType = call.isVideo ? 'video' : 'voice';

                if (antiCallConfig.logCalls) {
                    sock.logger?.info?.(`Incoming ${callType} call from ${callerJid}`);
                }

                const isAllowed = antiCallConfig.allowedNumbers?.includes(callerJid);
                if (isAllowed) {
                    if (antiCallConfig.logCalls) {
                        sock.logger?.info?.(`Call from ${callerJid} allowed (whitelisted)`);
                    }
                    continue;
                }

                const shouldReject = (call.isVideo && antiCallConfig.rejectVideoCalls) ||
                                   (!call.isVideo && antiCallConfig.rejectVoiceCalls);

                if (shouldReject) {
                    try {
                        if (sock.rejectCall) {
                            await sock.rejectCall(callId, callerJid);
                        }

                        if (antiCallConfig.logCalls) {
                            sock.logger?.info?.(`${callType} call from ${callerJid} rejected`);
                        }

                        if (antiCallConfig.customMessage && sock.sendMessage) {
                            await sock.sendMessage(callerJid, { text: antiCallConfig.customMessage });
                        }

                        if (antiCallConfig.blockAfterReject && sock.updateBlockStatus) {
                            await sock.updateBlockStatus(callerJid, 'block');
                            if (antiCallConfig.logCalls) {
                                sock.logger?.info?.(`${callerJid} blocked after call rejection`);
                            }
                        }
                    } catch (error) {
                        sock.logger?.error?.({ error }, `Failed to reject ${callType} call`);
                    }
                }
            }
        });
    }

    return sock;
};

/**
 * Create WhatsApp socket with iOS support
 */
const makeWASocketIOS = (config = {}) => {
    const iosConfig = {
        ...DEFAULT_CONNECTION_CONFIG,
        ...config,
        browser: config.browser || Browsers.iOS('Safari'),
        connectTimeoutMs: config.connectTimeoutMs || 30000,
        keepAliveIntervalMs: config.keepAliveIntervalMs || 25000
    };
    return makeWASocket(iosConfig);
};

/**
 * Create WhatsApp socket optimized for Apple devices
 */
const makeWASocketApple = (config = {}) => {
    const appleConfig = {
        ...DEFAULT_CONNECTION_CONFIG,
        ...config,
        browser: config.browser || Browsers.macOS('Safari'),
        connectTimeoutMs: config.connectTimeoutMs || 25000,
        keepAliveIntervalMs: config.keepAliveIntervalMs || 20000
    };
    return makeWASocket(appleConfig);
};

/**
 * Create WhatsApp socket for Android devices
 */
const makeWASocketAndroid = (config = {}) => {
    const androidConfig = {
        ...DEFAULT_CONNECTION_CONFIG,
        ...config,
        browser: config.browser || Browsers.android('Chrome'),
        connectTimeoutMs: config.connectTimeoutMs || 25000,
        keepAliveIntervalMs: config.keepAliveIntervalMs || 20000
    };
    return makeWASocket(androidConfig);
};

export { NexusHandler, makeWASocketIOS, makeWASocketApple, makeWASocketAndroid };
export default makeWASocket;