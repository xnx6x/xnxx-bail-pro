# XNXX Bail Pro

<p align="center">
  <img src="https://raw.githubusercontent.com/xnx6x/xnxx-bail-pro/main/assets/readme-banner.svg" alt="XNXX Bail Pro banner" width="100%" />
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/xnxx-bail-pro?style=for-the-badge&logo=npm&color=CB3837" alt="npm version" />
  <img src="https://img.shields.io/npm/dm/xnxx-bail-pro?style=for-the-badge&logo=npm&color=F97316" alt="npm downloads" />
  <img src="https://img.shields.io/github/stars/xnx6x/xnxx-bail-pro?style=for-the-badge&logo=github&color=111827" alt="github stars" />
  <img src="https://img.shields.io/badge/runtime-plugin%20system-0F766E?style=for-the-badge" alt="plugin system" />
</p>

<p align="center">
  <img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=700&size=22&pause=1100&color=FF6B6B&center=true&vCenter=true&width=1000&lines=Feature-first+Baileys+mod;Commands%2C+plugins%2C+menus%2C+rules%2C+queues;Buttons%2C+lists%2C+carousel%2C+sessions%2C+analytics;Detailed+examples+for+every+major+system" alt="animated intro" />
</p>

<p align="center">
  A Baileys-based WhatsApp library fork with a real runtime layer on top: commands, plugins, menu routing, anti-spam, permissions, queues, retries, sessions, analytics, and game foundations.
</p>

---

## What this package actually gives you

This package is not just a renamed socket export.

It currently gives you:

- standard Baileys-style socket exports
- a modular runtime at `sock.mod`
- command registration
- plugin registration
- menu routing for list and button replies
- queue and retry helpers
- anti-spam, rate limiting, and rule execution
- analytics and session helpers
- UI helpers for buttons, lists, carousel, flow steps, and progress updates
- starter plugins and battle foundations

If you want a README that behaves like a feature index, start here:

- [Install](#install)
- [Quick Start](#quick-start)
- [Command Runtime](#command-runtime)
- [Plugin System](#plugin-system)
- [Menu Routing](#menu-routing)
- [Buttons](#buttons)
- [Lists](#lists)
- [Hybrid Carousel](#hybrid-carousel)
- [Queue System](#queue-system)
- [Retry Engine](#retry-engine)
- [Permissions](#permission-system)
- [Anti-Spam and Rate Limiting](#anti-spam-and-rate-limiting)
- [Rule Engine](#rule-engine)
- [Analytics](#analytics)
- [Multi-Session](#multi-session)
- [Store Adapters](#store-adapters)
- [Game Foundations](#game-foundations)
- [Starter Commands](#starter-commands)

---

## Visual map

<p align="center">
  <img src="https://raw.githubusercontent.com/xnx6x/xnxx-bail-pro/main/assets/module-map.svg" alt="Architecture diagram" width="100%" />
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/xnx6x/xnxx-bail-pro/main/assets/readme-showcase.svg" alt="Feature showcase" width="100%" />
</p>

---

## Install

```bash
npm install xnxx-bail-pro
```

Or alias it as Baileys:

```json
{
  "dependencies": {
    "@whiskeysockets/baileys": "npm:xnxx-bail-pro"
  }
}
```

---

## Quick Start

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
    },
    antiSpam: {
      floodWindowMs: 7000,
      floodThreshold: 6,
      cooldownMs: 15000,
      autoMuteMs: 60000
    }
  })

  sock.ev.on('creds.update', saveCreds)
  return sock
}

connect()
```

---

## Command Runtime

<p>
  <img src="https://raw.githubusercontent.com/xnx6x/xnxx-bail-pro/main/assets/icon-runtime.svg" alt="Runtime icon" width="64" />
</p>

The command runtime is the main feature layer. It parses a prefix, resolves commands, checks permissions, applies cooldowns, and executes a handler with a rich context.

<details>
<summary><strong>Register a command</strong></summary>

```js
sock.mod.registerCommand({
  name: 'owner',
  aliases: ['adminpanel'],
  permission: 'admin.command',
  cooldownMs: 2000,
  execute: async ({ reply, chatId, userId, args }) => {
    await reply(`owner panel for ${userId} in ${chatId}`)
  }
})
```

</details>

<details>
<summary><strong>What the command handler receives</strong></summary>

```js
execute: async (ctx) => {
  console.log(ctx.chatId)
  console.log(ctx.userId)
  console.log(ctx.args)
  console.log(ctx.text)
  console.log(ctx.actionId)

  await ctx.reply('done')
}
```

Runtime context includes:

- `chatId`
- `userId`
- `participant`
- `message`
- `text`
- `actionId`
- `reply()`
- `warn()`
- `deleteMessage()`
- `forward()`
- `mute()`

</details>

---

## Plugin System

<p>
  <img src="https://raw.githubusercontent.com/xnx6x/xnxx-bail-pro/main/assets/icon-runtime.svg" alt="Plugin icon" width="64" />
</p>

Plugins let you register commands, rules, and role mappings in one place.

<details>
<summary><strong>Create a plugin</strong></summary>

```js
const ownerPlugin = {
  name: 'owner-tools',
  roles: {
    '923001234567': 'admin'
  },
  commands: [
    {
      name: 'panel',
      permission: 'admin.command',
      execute: async ({ reply }) => reply('owner panel')
    }
  ],
  rules: [
    {
      id: 'warn-links',
      when: {
        type: 'condition',
        left: 'text',
        operator: 'contains',
        right: 'https://'
      },
      then: [
        { type: 'warn', payload: { text: 'Links are restricted.' } }
      ]
    }
  ]
}

sock.mod.use(ownerPlugin)
```

</details>

---

## Menu Routing

<p>
  <img src="https://raw.githubusercontent.com/xnx6x/xnxx-bail-pro/main/assets/icon-ui.svg" alt="Menu icon" width="64" />
</p>

The menu system stores a menu definition, then resolves button or list replies back into commands.

<details>
<summary><strong>Build and send a list menu</strong></summary>

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

</details>

<details>
<summary><strong>Build and send a button menu</strong></summary>

```js
const menu = sock.mod.menus.buildButtonsMenu({
  id: 'quick',
  title: 'Quick Actions',
  text: 'Pick one',
  footer: 'Command router',
  items: [
    { id: 'ping', label: 'Ping', command: 'ping' },
    { id: 'battle', label: 'Battle', command: 'battle' }
  ]
})

await sock.mod.menus.register(jid, menu)
await sock.mod.sendButtons(jid, menu.payload)
```

</details>

The runtime resolves IDs like `menu:main:ping` and runs the mapped command automatically.

---

## Buttons

<p>
  <img src="https://raw.githubusercontent.com/xnx6x/xnxx-bail-pro/main/assets/icon-ui.svg" alt="Buttons icon" width="64" />
</p>

This package now builds outbound `buttonsMessage` correctly.

<details>
<summary><strong>Send buttons</strong></summary>

```js
await sock.mod.sendButtons(jid, {
  text: 'Choose an action',
  footer: 'Main control panel',
  buttons: [
    { id: 'battle:start', text: 'Start Battle' },
    { id: 'stats:view', text: 'View Stats' }
  ]
})
```

</details>

<details>
<summary><strong>Send buttons with a header title</strong></summary>

```js
await sock.mod.sendButtons(jid, {
  header: 'XNXX Bail Pro',
  text: 'Select one option',
  footer: 'Runtime demo',
  buttons: [
    { id: 'menu:open', text: 'Open Menu' },
    { id: 'owner:panel', text: 'Owner Panel' }
  ]
})
```

</details>

---

## Lists

<p>
  <img src="https://raw.githubusercontent.com/xnx6x/xnxx-bail-pro/main/assets/icon-ui.svg" alt="Lists icon" width="64" />
</p>

Lists work through the same high-level `sock.mod` API.

<details>
<summary><strong>Send a list</strong></summary>

```js
await sock.mod.sendList(jid, {
  title: 'Main Menu',
  text: 'Pick one module',
  buttonText: 'Open',
  sections: [
    {
      title: 'Systems',
      rows: [
        { id: 'analytics', title: 'Analytics', description: 'See activity data' },
        { id: 'games', title: 'Games', description: 'Play PvP and story mode' }
      ]
    }
  ]
})
```

</details>

---

## Hybrid Carousel

<p>
  <img src="https://raw.githubusercontent.com/xnx6x/xnxx-bail-pro/main/assets/icon-ui.svg" alt="Carousel icon" width="64" />
</p>

The helper builds a paged carousel-style payload from cards. This is a wrapper layer on top of the interactive support already in the fork.

<details>
<summary><strong>Send a carousel</strong></summary>

```js
await sock.mod.sendHybridCarousel(jid, {
  body: 'Carousel demo',
  footer: 'Page 1',
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
})
```

</details>

---

## Queue System

<p>
  <img src="https://raw.githubusercontent.com/xnx6x/xnxx-bail-pro/main/assets/icon-control.svg" alt="Queue icon" width="64" />
</p>

The queue system serializes work globally, per user, or per group. The main high-level helper is `sendQueued()`.

<details>
<summary><strong>Send through the built-in queue</strong></summary>

```js
await sock.mod.sendQueued(jid, { text: 'queued message' })
```

</details>

<details>
<summary><strong>Queue config example</strong></summary>

```js
const sock = makeModularWASocket(config, {
  queue: {
    global: { concurrency: 1, minIntervalMs: 100 },
    user: { concurrency: 1, minIntervalMs: 250 },
    group: { concurrency: 1, minIntervalMs: 150 }
  }
})
```

</details>

---

## Retry Engine

<p>
  <img src="https://raw.githubusercontent.com/xnx6x/xnxx-bail-pro/main/assets/icon-control.svg" alt="Retry icon" width="64" />
</p>

Retries are applied automatically by `sendQueued()`, and the `RetryEngine` is exported if you want custom retry flows.

<details>
<summary><strong>Retry config example</strong></summary>

```js
const sock = makeModularWASocket(config, {
  retry: {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10000
  }
})
```

</details>

---

## Permission System

<p>
  <img src="https://raw.githubusercontent.com/xnx6x/xnxx-bail-pro/main/assets/icon-control.svg" alt="Permission icon" width="64" />
</p>

Permissions are role-based, with extension points for custom rules.

Default role behavior:

- `admin` can do everything
- `mod` can do most non-admin actions
- `vip` can do non-admin actions
- `user` is limited to `public.*` actions unless you extend the system

<details>
<summary><strong>Configure roles</strong></summary>

```js
const sock = makeModularWASocket(config, {
  permissions: {
    roles: {
      '923001234567': 'admin',
      '923009999999': 'mod',
      '923008888888': 'vip'
    }
  }
})
```

</details>

<details>
<summary><strong>Use permission on a command</strong></summary>

```js
sock.mod.registerCommand({
  name: 'shutdown',
  permission: 'admin.command',
  execute: async ({ reply }) => reply('restricted action')
})
```

</details>

---

## Anti-Spam and Rate Limiting

<p>
  <img src="https://raw.githubusercontent.com/xnx6x/xnxx-bail-pro/main/assets/icon-control.svg" alt="Moderation icon" width="64" />
</p>

These run before command execution and before generic rules.

<details>
<summary><strong>Anti-spam config</strong></summary>

```js
const sock = makeModularWASocket(config, {
  antiSpam: {
    floodWindowMs: 7000,
    floodThreshold: 6,
    cooldownMs: 15000,
    autoMuteMs: 60000
  }
})
```

</details>

<details>
<summary><strong>Rate limiter config</strong></summary>

```js
const sock = makeModularWASocket(config, {
  rateLimiter: {
    perUser: { windowMs: 10000, limit: 8 },
    perGroup: { windowMs: 10000, limit: 20 },
    perCommand: { windowMs: 10000, limit: 5 }
  }
})
```

</details>

---

## Rule Engine

<p>
  <img src="https://raw.githubusercontent.com/xnx6x/xnxx-bail-pro/main/assets/icon-control.svg" alt="Rule engine icon" width="64" />
</p>

Rules are node-based. They are not meant to be handwritten nested `if/else` blocks everywhere in your bot.

Supported comparators:

- `contains`
- `equals`
- `startsWith`
- `regex`
- `gt`
- `lt`

Supported built-in actions:

- `reply`
- `warn`
- `delete`
- `mute`
- `forward`

<details>
<summary><strong>Rule: warn on links in groups</strong></summary>

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

</details>

<details>
<summary><strong>Rule: regex match</strong></summary>

```js
const modConfig = {
  rules: [
    {
      id: 'phone-filter',
      when: {
        type: 'condition',
        left: 'text',
        operator: 'regex',
        right: '\\\\b\\d{11,14}\\\\b'
      },
      then: [
        { type: 'warn', payload: { text: 'Phone numbers are blocked.' } }
      ]
    }
  ]
}
```

</details>

---

## Analytics

<p>
  <img src="https://raw.githubusercontent.com/xnx6x/xnxx-bail-pro/main/assets/icon-data.svg" alt="Analytics icon" width="64" />
</p>

The analytics system tracks per-user and per-group message activity.

<details>
<summary><strong>Read group stats</strong></summary>

```js
const stats = sock.mod.analytics.getGroupStats(jid)

console.log(stats.messageCount)
console.log(stats.activeUsers)
console.log(stats.heatmap)
console.log(stats.lastActiveAt)
```

</details>

<details>
<summary><strong>Read user stats</strong></summary>

```js
const stats = sock.mod.analytics.getUserStats('923001234567')
console.log(stats.messageCount)
console.log(stats.lastActiveAt)
```

</details>

---

## Multi-Session

<p>
  <img src="https://raw.githubusercontent.com/xnx6x/xnxx-bail-pro/main/assets/icon-session.svg" alt="Session icon" width="64" />
</p>

The package exports a session manager that can create isolated modular sockets.

<details>
<summary><strong>Create a session manager</strong></summary>

```js
import { createSessionManager } from 'xnxx-bail-pro'

const sessions = createSessionManager()
```

</details>

<details>
<summary><strong>Create a managed session</strong></summary>

```js
await sessions.createSession('bot-1', {
  config: {
    auth: state,
    printQRInTerminal: true
  },
  modConfig: {
    prefix: '.'
  }
})
```

</details>

<details>
<summary><strong>List or close sessions</strong></summary>

```js
console.log(sessions.listSessions())
await sessions.closeSession('bot-1')
```

</details>

---

## Store Adapters

<p>
  <img src="https://raw.githubusercontent.com/xnx6x/xnxx-bail-pro/main/assets/icon-data.svg" alt="Store icon" width="64" />
</p>

The exported store system supports:

- memory adapter
- Redis adapter pattern
- Mongo adapter pattern

<details>
<summary><strong>Use memory store</strong></summary>

```js
import { StoreSystem, MemoryStoreAdapter } from 'xnxx-bail-pro'

const store = new StoreSystem(new MemoryStoreAdapter())
await store.set('test', 'key1', { ok: true }, 60000)
const value = await store.get('test', 'key1')
```

</details>

<details>
<summary><strong>Use Redis adapter</strong></summary>

```js
import { StoreSystem, RedisStoreAdapter } from 'xnxx-bail-pro'

const redisAdapter = new RedisStoreAdapter(redisClient)
const store = new StoreSystem(redisAdapter)
```

</details>

<details>
<summary><strong>Use Mongo adapter</strong></summary>

```js
import { StoreSystem, MongoStoreAdapter } from 'xnxx-bail-pro'

const mongoAdapter = new MongoStoreAdapter(collection)
const store = new StoreSystem(mongoAdapter)
```

</details>

---

## Game Foundations

<p>
  <img src="https://raw.githubusercontent.com/xnx6x/xnxx-bail-pro/main/assets/icon-game.svg" alt="Game icon" width="64" />
</p>

These are foundation systems. They give you state and helper logic, not a finished game.

<details>
<summary><strong>PvP battle state</strong></summary>

```js
await sock.mod.games.createBattle(`battle-${jid}`, [
  { id: 'player1', name: 'Player 1' },
  { id: 'enemy', name: 'Enemy' }
])

const update = await sock.mod.games.performBattleAction(`battle-${jid}`, 'player1', 'attack')
console.log(update.log)
console.log(update.players)
```

</details>

<details>
<summary><strong>Loot roll helper</strong></summary>

```js
const loot = sock.mod.games.rollLoot([
  { name: 'Common Box', weight: 70 },
  { name: 'Rare Box', weight: 25 },
  { name: 'Legendary Box', weight: 5 }
])
```

</details>

<details>
<summary><strong>Story state</strong></summary>

```js
const story = {
  id: 'case-1',
  startNodeId: 'intro',
  nodes: [
    { id: 'intro', choices: [{ id: 'go-left', nextNodeId: 'left' }] },
    { id: 'left', choices: [] }
  ]
}

let state = sock.mod.games.createStoryState(story)
state = sock.mod.games.advanceStory(story, state, 'go-left')
```

</details>

<details>
<summary><strong>Detective case state</strong></summary>

```js
const detectiveCase = sock.mod.games.createDetectiveCase({
  id: 'detective-1',
  suspects: ['A', 'B', 'C'],
  clues: ['ticket', 'photo']
})
```

</details>

---

## Starter Commands

Starter plugins are loaded by default unless you set `loadStarterPlugins: false`.

Included starter commands:

- `.ping`
- `.menu`
- `.help`
- `.stats`
- `.battle`
- `.attack`
- `.defend`

<details>
<summary><strong>Disable starter plugins</strong></summary>

```js
const sock = makeModularWASocket(config, {
  loadStarterPlugins: false
})
```

</details>

---

## Main Exports

```js
import makeModularWASocket, {
  createModFramework,
  createSessionManager,
  CommandRegistry,
  CommandRuntime,
  CooldownManager,
  MenuSystem,
  PluginManager,
  QueueSystem,
  RetryEngine,
  RuleEngine,
  StoreSystem,
  MemoryStoreAdapter,
  RedisStoreAdapter,
  MongoStoreAdapter,
  createCorePlugin,
  createModerationPlugin
} from 'xnxx-bail-pro'
```

---

## Example file

There is a runnable example in:

- `example.mod.js`

It shows:

- modular socket boot
- queue and anti-spam config
- starter command visibility
- button/list/carousel sending

---

## Project layout

```text
lib/
  Mod/
    analytics-system.js
    command-system.js
    control-system.js
    game-system.js
    menu-system.js
    permissions.js
    plugin-system.js
    queue-system.js
    retry-engine.js
    rule-engine.js
    session-system.js
    starter-plugins.js
    store-system.js
    ui-system.js
```

---

## Upstream note

This package still sits on top of a forked Baileys build. That means upstream protocol and transport changes still matter.

Recommended strategy:

1. keep low-level socket changes small
2. keep new product features in `lib/Mod`
3. build advanced bot behavior through commands and plugins

Upstream references:

- [WhiskeySockets/Baileys](https://github.com/WhiskeySockets/Baileys)
- [Baileys wiki](https://baileys.wiki)
- [Migration guide](https://whiskey.so/migrate-latest)

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

This project is not affiliated with WhatsApp. Use it responsibly.
