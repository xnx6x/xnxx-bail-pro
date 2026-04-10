# XNXX Bail Pro

<p align="center">
  <img src="https://raw.githubusercontent.com/xnx6x/xnxx-bail-pro/main/assets/readme-banner.svg" alt="XNXX Bail Pro banner" width="100%" />
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/xnxx-bail-pro?style=for-the-badge&logo=npm&color=CB3837" alt="npm version" />
  <img src="https://img.shields.io/npm/dm/xnxx-bail-pro?style=for-the-badge&logo=npm&color=F97316" alt="npm downloads" />
  <img src="https://img.shields.io/github/stars/xnx6x/xnxx-bail-pro?style=for-the-badge&logo=github&color=111827" alt="github stars" />
  <img src="https://img.shields.io/badge/runtime-plugin%20driven-0F766E?style=for-the-badge" alt="plugin driven runtime" />
</p>

<p align="center">
  <img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=700&size=22&pause=1100&color=FF6B6B&center=true&vCenter=true&width=980&lines=WhatsApp+automation+with+a+real+runtime;Plugin+system%2C+menus%2C+permissions%2C+cooldowns;Queues%2C+retry+engine%2C+analytics%2C+multi-session;Interactive+UI+plus+game+and+story+foundations" alt="animated intro" />
</p>

<p align="center">
  A Baileys-based WhatsApp Web API fork with a stronger platform layer: command runtime, plugin loader, menu routing, moderation systems, analytics, queues, retry logic, sessions, and rich interactive helpers.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/xnxx-bail-pro">NPM</a>
  ·
  <a href="https://github.com/xnx6x/xnxx-bail-pro">GitHub</a>
  ·
  <a href="https://github.com/WhiskeySockets/Baileys">Upstream Baileys</a>
  ·
  <a href="https://baileys.wiki">Docs</a>
</p>

---

## Built for a real mod, not just a fork

Most Baileys mods become hard to maintain because every new idea gets shoved into socket files.

This project pushes in a different direction:

- low-level socket and protocol behavior stays in the library core
- runtime systems live in `lib/Mod`
- commands, menus, plugins, rules, and games can grow without wrecking the transport layer

That makes the project easier to extend, easier to debug, and much easier to keep alive when upstream Baileys changes again.

---

## What changed

- fixed outbound `buttons` and `list` generation
- added a proper command runtime with aliases and cooldowns
- added plugin registration for commands, rules, and roles
- added menu routing for button and list responses
- added anti-spam, mute flow, and rate limiting
- added permission scaffolding for admin, mod, vip, and custom policies
- added queue system with global, per-user, and per-group scheduling
- added retry engine with backoff
- added analytics counters and group activity data
- added session manager and isolated socket helper
- added starter game systems for battle, loot, story state, and detective state
- improved the README and package visuals for GitHub and npm

---

## Visual map

<p align="center">
  <img src="https://raw.githubusercontent.com/xnx6x/xnxx-bail-pro/main/assets/module-map.svg" alt="Architecture diagram" width="100%" />
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/xnx6x/xnxx-bail-pro/main/assets/readme-showcase.svg" alt="Feature showcase" width="100%" />
</p>

---

## Feature stack

### Runtime

- plugin-based command system
- aliases and cooldowns
- menu routing
- rich execution context

### Moderation

- anti-spam engine
- rate limiter
- permission system
- node-style rule engine

### Delivery

- global queue
- per-user queue
- per-group queue
- retry engine

### UI

- buttons
- lists
- hybrid carousel helper
- multi-step flow helper
- progress update helper

### Data

- memory adapter
- Redis adapter pattern
- Mongo adapter pattern
- TTL-backed state

### Sessions and analytics

- isolated multi-session manager
- message counters
- active user tracking
- group activity heatmap primitives

### Game foundations

- PvP battle state
- loot roll helper
- story progression state
- detective case state

---

## Install

```bash
npm install xnxx-bail-pro
```

Or alias it:

```json
{
  "dependencies": {
    "@whiskeysockets/baileys": "npm:xnxx-bail-pro"
  }
}
```

---

## Quick start

```js
import makeModularWASocket, { useMultiFileAuthState } from 'xnxx-bail-pro'

async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_session')

  const sock = makeModularWASocket({
    auth: state,
    printQRInTerminal: true
  }, {
    prefix: '.',
    queue: {
      global: { concurrency: 1, minIntervalMs: 100 },
      user: { concurrency: 1, minIntervalMs: 250 },
      group: { concurrency: 1, minIntervalMs: 150 }
    }
  })

  sock.ev.on('creds.update', saveCreds)
}

connect()
```

---

## Starter commands

The runtime loads starter plugins by default.

- `.ping`
- `.menu`
- `.help`
- `.stats`
- `.battle`
- `.attack`
- `.defend`

These are there to prove the framework works immediately. Replace them with your own plugins whenever you want.

---

## Example: plugin-driven commands

```js
sock.mod.registerCommand({
  name: 'owner',
  aliases: ['adminpanel'],
  permission: 'admin.command',
  cooldownMs: 2000,
  execute: async ({ reply }) => {
    await reply('owner panel opened')
  }
})
```

---

## Example: menus that route back into commands

```js
const menu = sock.mod.menus.buildListMenu({
  id: 'main',
  title: 'Main Menu',
  text: 'Choose a system',
  sections: [
    {
      title: 'Core',
      rows: [
        { id: 'ping', label: 'Ping', description: 'Check status', command: 'ping' },
        { id: 'stats', label: 'Stats', description: 'View analytics', command: 'stats' }
      ]
    }
  ]
})

await sock.mod.menus.register(jid, menu)
await sock.mod.sendList(jid, menu.payload)
```

When the user taps a row, the runtime can resolve the menu item and execute the mapped command.

---

## Example: rules without messy if/else chains

```js
const modConfig = {
  rules: [
    {
      id: 'link-warning',
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
}
```

Supported comparators include `contains`, `equals`, `startsWith`, `regex`, `gt`, and `lt`.

---

## Example: battle foundation

```js
await sock.mod.games.createBattle(`battle-${jid}`, [
  { id: 'player1', name: 'Player 1' },
  { id: 'enemy', name: 'Enemy' }
])

const update = await sock.mod.games.performBattleAction(`battle-${jid}`, 'player1', 'attack')
```

This is a foundation layer, not a finished RPG. It gives you the state engine to build on.

---

## Main exports

```js
import makeModularWASocket, {
  createModFramework,
  createSessionManager,
  CommandRegistry,
  CommandRuntime,
  PluginManager,
  MenuSystem,
  QueueSystem,
  RetryEngine,
  RuleEngine
} from 'xnxx-bail-pro'
```

Useful helpers:

- `sock.mod.sendQueued(jid, content, options)`
- `sock.mod.sendButtons(jid, payload, options)`
- `sock.mod.sendList(jid, payload, options)`
- `sock.mod.sendHybridCarousel(jid, payload, options)`
- `sock.mod.sendFlowStep(jid, flow, state, options)`
- `sock.mod.sendProgressUpdate(jid, payload, editKey, options)`
- `sock.mod.registerCommand(command)`
- `sock.mod.use(plugin)`

---

## Project layout

```text
lib/
  Mod/
    command-system.js
    control-system.js
    menu-system.js
    plugin-system.js
    queue-system.js
    retry-engine.js
    rule-engine.js
    starter-plugins.js
    store-system.js
    ui-system.js
```

---

## Upstream note

This package still needs careful upstream maintenance because `@whiskeysockets/baileys` keeps moving and the `7.x` line already introduced breaking changes.

The safest long-term strategy is:

1. keep protocol and socket fixes close to upstream
2. keep platform features isolated in `lib/Mod`
3. move flashy bot systems into plugins, not transport files

Upstream references:

- [WhiskeySockets/Baileys](https://github.com/WhiskeySockets/Baileys)
- [Baileys migration guide](https://whiskey.so/migrate-latest)
- [Baileys wiki](https://baileys.wiki)

---

## Local development

```bash
npm install
node example.mod.js
```

If you want the startup banner:

```bash
set XNXX_BAIL_PRO_SHOW_BANNER=1
```

---

## Disclaimer

This project is not affiliated with WhatsApp. Use it responsibly and do not use it for abuse, spam, scams, or harassment.
