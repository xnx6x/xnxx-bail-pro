const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export class GameSystem {
    constructor(store) {
        this.store = store;
    }

    async createBattle(id, players) {
        const battle = {
            id,
            players: players.map(player => ({ ...player, hp: player.hp ?? 100, defending: false })),
            turn: 0,
            log: []
        };
        await this.store.set('battle', id, battle);
        return battle;
    }

    async getBattle(id) {
        return this.store.get('battle', id);
    }

    async performBattleAction(id, actorId, action) {
        const battle = await this.getBattle(id);
        if (!battle) {
            throw new Error(`Battle not found: ${id}`);
        }

        const actor = battle.players.find(player => player.id === actorId);
        const target = battle.players.find(player => player.id !== actorId);
        if (!actor || !target) {
            throw new Error('Invalid battle participants');
        }

        if (action === 'defend') {
            actor.defending = true;
            battle.log.push(`${actor.name} is defending`);
        } else {
            const baseDamage = Math.floor(Math.random() * 18) + 8;
            const damage = target.defending ? Math.ceil(baseDamage / 2) : baseDamage;
            target.hp = clamp(target.hp - damage, 0, 100);
            target.defending = false;
            battle.log.push(`${actor.name} attacked ${target.name} for ${damage}`);
        }

        battle.turn += 1;
        await this.store.set('battle', id, battle);
        return battle;
    }

    rollLoot(table = []) {
        const totalWeight = table.reduce((sum, item) => sum + item.weight, 0);
        const roll = Math.random() * totalWeight;
        let cursor = 0;
        for (const item of table) {
            cursor += item.weight;
            if (roll <= cursor) {
                return item;
            }
        }
        return table[table.length - 1];
    }

    createStoryState(story) {
        return {
            storyId: story.id,
            nodeId: story.startNodeId,
            visited: []
        };
    }

    advanceStory(story, state, choiceId) {
        const node = story.nodes.find(item => item.id === state.nodeId);
        const choice = node?.choices?.find(item => item.id === choiceId);
        if (!choice) {
            throw new Error('Invalid story choice');
        }
        return {
            ...state,
            nodeId: choice.nextNodeId,
            visited: [...state.visited, state.nodeId]
        };
    }

    createDetectiveCase(caseFile) {
        return {
            ...caseFile,
            discoveredClues: [],
            selectedSuspectId: null
        };
    }
}

export default GameSystem;
