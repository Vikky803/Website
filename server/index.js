/**
 * Standalone launcher — lets you test the dashboard server and frontend
 * BEFORE wiring it into your real bot. Uses a fake mock "client" object
 * so /api/status returns believable data without a real Discord connection.
 *
 * For the real thing, don't run this file — instead require('./dashboard-server')
 * from your bot's own client.js. See README.md.
 */
const { EventEmitter } = require('events');
const { startDashboard } = require('./dashboard-server');

console.log('[Dashboard] Starting in STANDALONE MOCK MODE — not connected to a real bot.');
console.log('[Dashboard] To connect to your real bot, see README.md instead of running this file.\n');

const mockClient = new EventEmitter();
mockClient.user = {
  tag: 'Heaven Manager#0000',
  displayAvatarURL: () => null,
  setPresence: async () => {},
};
mockClient.ws = { status: 0, ping: 47 };
mockClient.commands = new Map(Array.from({ length: 180 }, (_, i) => [`cmd${i}`, {}]));
mockClient.prefixCommands = new Map(Array.from({ length: 177 }, (_, i) => [`pcmd${i}`, {}]));

const mockGuilds = Array.from({ length: 12 }, (_, i) => ({
  id: `mock-${i}`,
  name: `Mock Server ${i + 1}`,
  memberCount: Math.floor(Math.random() * 4000) + 50,
  iconURL: () => null,
  channels: { cache: new Map() },
  leave: async () => {
    mockClient.guilds.cache.delete(`mock-${i}`);
  },
}));

mockClient.guilds = { cache: new Map(mockGuilds.map((g) => [g.id, g])) };

startDashboard(mockClient);
