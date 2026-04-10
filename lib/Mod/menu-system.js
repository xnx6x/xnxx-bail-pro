export class MenuSystem {
    constructor(store) {
        this.store = store;
    }

    key(chatId, menuId) {
        return `menu:${chatId}:${menuId}`;
    }

    async register(chatId, menu, ttlMs = 15 * 60 * 1000) {
        await this.store.set('menus', this.key(chatId, menu.id), menu, ttlMs);
        return menu;
    }

    async resolve(chatId, actionId) {
        if (!actionId || !actionId.startsWith('menu:')) {
            return null;
        }

        const parts = actionId.split(':');
        const menuId = parts[1];
        const itemId = parts.slice(2).join(':');
        const menu = await this.store.get('menus', this.key(chatId, menuId));
        if (!menu) {
            return null;
        }

        const item = (menu.items || []).find(entry => entry.id === itemId);
        return item ? { menu, item } : null;
    }

    buildButtonsMenu({ id, title, text, footer, items = [] }) {
        return {
            id,
            type: 'buttons',
            items,
            payload: {
                text,
                footer,
                header: title,
                buttons: items.slice(0, 3).map(item => ({
                    id: `menu:${id}:${item.id}`,
                    text: item.label
                }))
            }
        };
    }

    buildListMenu({ id, title, text, footer, buttonText = 'Open', sections = [] }) {
        const items = sections.flatMap(section => section.rows || []);
        return {
            id,
            type: 'list',
            items,
            payload: {
                title,
                text,
                footer,
                buttonText,
                sections: sections.map(section => ({
                    title: section.title,
                    rows: (section.rows || []).map(row => ({
                        id: `menu:${id}:${row.id}`,
                        title: row.label || row.title,
                        description: row.description || ''
                    }))
                }))
            }
        };
    }
}

export default MenuSystem;
