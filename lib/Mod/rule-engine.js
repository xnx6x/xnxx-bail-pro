const comparators = {
    contains: (left, right) => typeof left === 'string' && left.includes(right),
    equals: (left, right) => left === right,
    startsWith: (left, right) => typeof left === 'string' && left.startsWith(right),
    gt: (left, right) => left > right,
    lt: (left, right) => left < right
};

export class RuleEngine {
    constructor(rules = []) {
        this.rules = [...rules];
    }

    addRule(rule) {
        this.rules.push(rule);
    }

    getValue(path, context) {
        return path.split('.').reduce((acc, key) => acc?.[key], context);
    }

    async executeAction(action, context) {
        switch (action.type) {
            case 'reply':
                return context.reply?.(action.payload?.text || '');
            case 'warn':
                return context.warn?.(action.payload?.text || 'Warning');
            case 'delete':
                return context.deleteMessage?.();
            case 'mute':
                return context.mute?.(action.payload?.durationMs || 60000);
            case 'forward':
                return context.forward?.(action.payload?.jid);
            default:
                return action.run?.(context);
        }
    }

    async evaluateNode(node, context) {
        if (node.type === 'group') {
            const results = await Promise.all((node.children || []).map(child => this.evaluateNode(child, context)));
            return node.operator === 'OR' ? results.some(Boolean) : results.every(Boolean);
        }

        const left = this.getValue(node.left, context);
        const comparator = comparators[node.operator || 'equals'];
        if (!comparator) {
            throw new Error(`Unknown rule comparator: ${node.operator}`);
        }
        return comparator(left, node.right);
    }

    async run(context) {
        const applied = [];
        for (const rule of this.rules) {
            const matched = await this.evaluateNode(rule.when, context);
            if (!matched) {
                continue;
            }

            for (const action of rule.then || []) {
                await this.executeAction(action, context);
            }

            applied.push(rule.id || rule.name || 'rule');
        }

        return applied;
    }
}

export default RuleEngine;
