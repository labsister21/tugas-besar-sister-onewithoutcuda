import { startServer } from './server/Server';

const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('Usage: npm run dev -- <nodeId> <port> [host] [peers]');
  process.exit(1);
}

const id = args[0];
const port = parseInt(args[1], 10);
const host = args[2] || 'localhost';
const peers = args[3] ? args[3].split(',') : [];

if (isNaN(port)) {
  console.error('Port must be a valid number.');
  process.exit(1);
}

startServer(id, port, peers, host);
