export class PermissionSystem {
    constructor(config = {}) {
        this.roles = new Map(Object.entries(config.roles || {}));
        this.rules = [...(config.rules || [])];
    }

    setRole(subjectId, role) {
        this.roles.set(subjectId, role);
    }

    getRole(subjectId) {
        return this.roles.get(subjectId) || 'user';
    }

    addRule(rule) {
        this.rules.push(rule);
    }

    async can(action, context = {}) {
        const role = this.getRole(context.userId);
        for (const rule of this.rules) {
            if (rule.action && rule.action !== action) {
                continue;
            }
            const result = await rule.check({ ...context, role, action });
            if (typeof result === 'boolean') {
                return result;
            }
        }

        if (role === 'admin') {
            return true;
        }

        if (role === 'mod') {
            return !['dangerous.admin.only'].includes(action);
        }

        return role === 'vip' ? action !== 'dangerous.admin.only' : action.startsWith('public.');
    }
}

export default PermissionSystem;
