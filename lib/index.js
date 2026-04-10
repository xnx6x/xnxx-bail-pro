/**
 * XNXX Bail Pro - WhatsApp Web API
 * @version 2.1.0
 * @license MIT
 */

import gradient from 'gradient-string';

const VERSION = '2.1.0';

const banner = `
╔══════════════════════════════════════════════════════════════════╗
║                                                                  ║
║        ██╗  ██╗███╗   ██╗██╗  ██╗██╗  ██╗                        ║
║        ╚██╗██╔╝████╗  ██║╚██╗██╔╝╚██╗██╔╝                        ║
║         ╚███╔╝ ██╔██╗ ██║ ╚███╔╝  ╚███╔╝                         ║
║         ██╔██╗ ██║╚██╗██║ ██╔██╗  ██╔██╗                         ║
║        ██╔╝ ██╗██║ ╚████║██╔╝ ██╗██╔╝ ██╗                        ║
║        ╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝╚═╝  ╚═╝                        ║
║                                                                  ║
║          ██████╗  █████╗ ██╗██╗     ███████╗██╗   ██╗███████╗    ║
║          ██╔══██╗██╔══██╗██║██║     ██╔════╝╚██╗ ██╔╝██╔════╝    ║
║          ██████╔╝███████║██║██║     █████╗   ╚████╔╝ ███████╗    ║
║          ██╔══██╗██╔══██║██║██║     ██╔══╝    ╚██╔╝  ╚════██║    ║
║          ██████╔╝██║  ██║██║███████╗███████╗   ██║   ███████║    ║
║          ╚═════╝ ╚═╝  ╚═╝╚═╝╚══════╝╚══════╝   ╚═╝   ╚══════╝    ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
`;

const info = `
┌───────────────────────────────────────────────────────────────────────┐
│  ⚡ xnxx-bail-pro                                                     │
│  🩸 v${VERSION}                                                            │
├───────────────────────────────────────────────────────────────────────┤
│  WhatsApp Web API                                                     │
│  Multi-Device • Encryption • Media Support                            │
├───────────────────────────────────────────────────────────────────────┤
│  github.com/xnx6x/xnxx-bail-pro                                       │
│  Built with passion                                                   │
└───────────────────────────────────────────────────────────────────────┘
`;

const shouldShowBanner = process.env.XNXX_BAIL_PRO_SHOW_BANNER === '1';

if (shouldShowBanner) {
    try {
        console.log(gradient(['#DC143C', '#8B0000', '#2D0000'])(banner));
        console.log(gradient(['#8B0000', '#4A0000', '#1C1C1C'])(info));
        console.log(gradient(['#DC143C', '#2D0000'])('\n⚡ Initializing Socket Connection...\n'));
    } catch {
        console.log('\n⚡ XNXX Bail Pro v' + VERSION + ' - Initializing...\n');
    }
}

import makeWASocket, { makeWASocketIOS, makeWASocketApple, makeWASocketAndroid, NexusHandler } from './Socket/index.js';
import MessageHandler from './Socket/Rhandler.js';
export * from '../WAProto/index.js';
export * from './Utils/index.js';
export * from './Store/index.js';
export * from './Types/index.js';
export * from './Defaults/index.js';
export * from './Mod/index.js';
export * from './WABinary/index.js';
export * from './WAM/index.js';
export * from './WAUSync/index.js';
export { NexusHandler, MessageHandler, makeWASocketIOS, makeWASocketApple, makeWASocketAndroid, makeWASocket };
export default makeWASocket;
