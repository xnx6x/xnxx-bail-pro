export class PluginManager {
    constructor({ commands, rules, permissions }) {
        this.commands = commands;
        this.rules = rules;
        this.permissions = permissions;
        this.plugins = [];
    }

    use(plugin) {
        this.plugins.push(plugin);

        for (const command of plugin.commands || []) {
            this.commands.register(command);
        }

        for (const rule of plugin.rules || []) {
            this.rules.addRule(rule);
        }

        for (const [subject, role] of Object.entries(plugin.roles || {})) {
            this.permissions.setRole(subject, role);
        }

        return plugin;
    }

    list() {
        return this.plugins;
    }
}

export default PluginManager;
