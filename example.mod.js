import makeModularWASocket, {
    createSessionManager,
    useMultiFileAuthState
} from './lib/index.js';

const modConfig = {
    queue: {
        global: { concurrency: 1, minIntervalMs: 100 },
        user: { concurrency: 1, minIntervalMs: 250 },
        group: { concurrency: 1, minIntervalMs: 150 }
    },
    retry: {
        maxRetries: 3,
        baseDelayMs: 1000
    },
    rules: [
        {
            id: 'block-link',
            when: {
                type: 'condition',
                left: 'text',
                operator: 'contains',
                right: 'https://'
            },
            then: [
                { type: 'reply', payload: { text: 'Links are not allowed here.' } }
            ]
        }
    ],
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
                footer: 'Baileys Mod',
                buttons: [
                    { id: 'battle:start', text: 'Start Battle' },
                    { id: 'menu:open', text: 'Open Menu' }
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
                            { id: 'analytics', title: 'Analytics', description: 'View group activity' },
                            { id: 'games', title: 'Games', description: 'Play PvP and story mode' }
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
                        title: 'Card One',
                        text: 'Image or video card support starts here',
                        buttons: [{ name: 'quick_reply', params: { display_text: 'Open', id: 'card:1' } }]
                    },
                    {
                        title: 'Card Two',
                        text: 'Add your own imageUrl/video flow wrapper next',
                        buttons: [{ name: 'quick_reply', params: { display_text: 'Next', id: 'card:2' } }]
                    }
                ]
            });
        }
    });

    const sessions = createSessionManager();
    console.log('Session manager ready:', sessions.listSessions());
}

main().catch(console.error);
