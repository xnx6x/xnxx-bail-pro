import makeModularWASocket, {
    createSessionManager,
    useMultiFileAuthState
} from './lib/index.js';

const modConfig = {
    prefix: '.',
    queue: {
        global: { concurrency: 1, minIntervalMs: 100 },
        user: { concurrency: 1, minIntervalMs: 250 },
        group: { concurrency: 1, minIntervalMs: 150 }
    },
    retry: {
        maxRetries: 3,
        baseDelayMs: 1000
    },
    antiSpam: {
        floodWindowMs: 7000,
        floodThreshold: 6,
        cooldownMs: 15000,
        autoMuteMs: 60000
    },
    permissions: {
        roles: {
            'owner-number': 'admin'
        }
    }
};

async function main() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_session_main');

    const sock = makeModularWASocket({
        auth: state,
        printQRInTerminal: true
    }, modConfig);

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
        if (connection === 'open') {
            console.log('Mod socket connected');
        }

        if (connection === 'close') {
            console.log('Connection closed', lastDisconnect?.error?.message);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages?.[0];
        const jid = msg?.key?.remoteJid;
        const text = msg?.message?.conversation || msg?.message?.extendedTextMessage?.text || '';
        if (!jid || msg?.key?.fromMe) {
            return;
        }

        if (text === '.buttons') {
            await sock.mod.sendButtons(jid, {
                text: 'Choose an action',
                footer: 'XNXX Bail Pro',
                buttons: [
                    { id: 'menu:main:ping', text: 'Ping' },
                    { id: 'menu:main:stats', text: 'Stats' }
                ]
            });
        }

        if (text === '.list') {
            await sock.mod.sendList(jid, {
                title: 'Main Menu',
                text: 'Select a module',
                buttonText: 'Open',
                sections: [
                    {
                        title: 'Systems',
                        rows: [
                            { id: 'menu:main:ping', title: 'Ping', description: 'Check bot status' },
                            { id: 'menu:main:stats', title: 'Stats', description: 'View group stats' },
                            { id: 'menu:main:battle', title: 'Battle', description: 'Start battle demo' }
                        ]
                    }
                ]
            });
        }

        if (text === '.carousel') {
            await sock.mod.sendHybridCarousel(jid, {
                body: 'Hybrid carousel demo',
                footer: 'Page demo',
                cards: [
                    {
                        title: 'Control Runtime',
                        text: 'Commands, cooldowns, anti-spam, permissions',
                        buttons: [{ name: 'quick_reply', params: { display_text: 'Open', id: 'runtime:open' } }]
                    },
                    {
                        title: 'Game Layer',
                        text: 'PvP, story mode, detective state, loot',
                        buttons: [{ name: 'quick_reply', params: { display_text: 'Play', id: 'game:play' } }]
                    }
                ]
            });
        }
    });

    const sessions = createSessionManager();
    console.log('Session manager ready:', sessions.listSessions());
    console.log('Starter commands:', sock.mod.commands.list().map(command => command.name).join(', '));
}

main().catch(console.error);
