const formatStats = (stats) => [
    `Messages: ${stats.messageCount || 0}`,
    `Last active: ${stats.lastActiveAt ? new Date(stats.lastActiveAt).toLocaleString() : 'n/a'}`
].join('\n');

export const createCorePlugin = (mod) => ({
    name: 'core',
    commands: [
        {
            name: 'ping',
            aliases: ['alive'],
            cooldownMs: 2000,
            permission: 'public.command',
            execute: async ({ reply }) => reply('pong')
        },
        {
            name: 'menu',
            aliases: ['help'],
            cooldownMs: 1500,
            permission: 'public.command',
            execute: async ({ chatId }) => {
                const menu = mod.menus.buildListMenu({
                    id: 'main',
                    title: 'XNXX Bail Pro',
                    text: 'Choose a system',
                    footer: 'Interactive control panel',
                    sections: [
                        {
                            title: 'Core',
                            rows: [
                                { id: 'ping', label: 'Ping', description: 'Check bot status', command: 'ping' },
                                { id: 'stats', label: 'Stats', description: 'View activity stats', command: 'stats' },
                                { id: 'battle', label: 'Battle', description: 'Start a PvP demo', command: 'battle' }
                            ]
                        }
                    ]
                });
                await mod.menus.register(chatId, menu);
                return mod.sendList(chatId, menu.payload);
            }
        },
        {
            name: 'stats',
            cooldownMs: 3000,
            permission: 'public.command',
            execute: async ({ chatId, reply }) => {
                const stats = mod.analytics.getGroupStats(chatId);
                await reply(`Group stats\n${formatStats(stats)}\nActive users: ${(stats.activeUsers || []).length}`);
            }
        },
        {
            name: 'battle',
            cooldownMs: 3000,
            permission: 'public.command',
            execute: async ({ chatId, userId, reply }) => {
                const battleId = `battle-${chatId}`;
                await mod.games.createBattle(battleId, [
                    { id: userId, name: 'Player 1' },
                    { id: 'enemy', name: 'Enemy' }
                ]);
                await reply('Battle started. Use .attack or .defend');
            }
        },
        {
            name: 'attack',
            cooldownMs: 1500,
            permission: 'public.command',
            execute: async ({ chatId, userId, reply }) => {
                const battle = await mod.games.performBattleAction(`battle-${chatId}`, userId, 'attack');
                await reply(`Battle update\n${battle.log.at(-1)}\nHP: ${battle.players.map(p => `${p.name}=${p.hp}`).join(' | ')}`);
            }
        },
        {
            name: 'defend',
            cooldownMs: 1500,
            permission: 'public.command',
            execute: async ({ chatId, userId, reply }) => {
                const battle = await mod.games.performBattleAction(`battle-${chatId}`, userId, 'defend');
                await reply(`Battle update\n${battle.log.at(-1)}\nHP: ${battle.players.map(p => `${p.name}=${p.hp}`).join(' | ')}`);
            }
        }
    ]
});

export const createModerationPlugin = () => ({
    name: 'moderation',
    rules: [
        {
            id: 'warn-link',
            when: {
                type: 'group',
                operator: 'AND',
                children: [
                    { type: 'condition', left: 'isGroup', operator: 'equals', right: true },
                    { type: 'condition', left: 'text', operator: 'contains', right: 'https://' }
                ]
            },
            then: [
                { type: 'warn', payload: { text: 'Links are restricted in this chat.' } }
            ]
        }
    ]
});

export default {
    createCorePlugin,
    createModerationPlugin
};
