export class UISystem {
    buildButtonsMessage({ text, footer, buttons = [], header } = {}) {
        return {
            buttonsMessage: {
                text,
                footerText: footer,
                title: header,
                buttons
            }
        };
    }

    buildListMessage({ title, text, footer, buttonText, sections = [] } = {}) {
        return {
            listMessage: {
                title,
                description: text,
                footerText: footer,
                buttonText,
                sections
            }
        };
    }

    buildHybridCarousel({ body, footer, cards = [], page = 0, pageSize = 5 } = {}) {
        const start = page * pageSize;
        const pagedCards = cards.slice(start, start + pageSize);
        return {
            carousel: {
                caption: body,
                footer: footer ? `${footer} (${page + 1}/${Math.max(1, Math.ceil(cards.length / pageSize))})` : `${page + 1}/${Math.max(1, Math.ceil(cards.length / pageSize))}`,
                cards: pagedCards.map(card => ({
                    headerTitle: card.title,
                    headerSubtitle: card.subtitle,
                    bodyText: card.text,
                    footerText: card.footer,
                    imageUrl: card.imageUrl,
                    buttons: card.buttons || []
                }))
            }
        };
    }

    buildFlowStep(flow, state) {
        const step = flow.steps.find(item => item.id === state.stepId) || flow.steps[0];
        return {
            interactiveMessage: {
                header: flow.title || step.title,
                title: step.body,
                footer: step.footer || flow.footer,
                buttons: (step.actions || []).map(action => ({
                    name: action.name || 'quick_reply',
                    buttonParamsJson: JSON.stringify({
                        display_text: action.label,
                        id: action.id
                    })
                })),
                contextInfo: {
                    flowId: flow.id,
                    stepId: step.id,
                    state: state.data || {}
                }
            }
        };
    }

    buildProgressUpdate({ text, current, total, footer } = {}) {
        const progress = total ? `${current}/${total}` : `${current}`;
        return {
            text: `${text}\nProgress: ${progress}`,
            footer
        };
    }
}

export default UISystem;
