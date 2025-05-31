import readline from 'readline';
import { RaftClient } from './client/RaftClient';

const args = process.argv.slice(2);
if (args.length !== 1) {
  console.error('Usage: ts-node index-client.ts <seed-host:port>');
  process.exit(1);
}

const seedArg = args[0];
const [host, portStr] = seedArg.includes(':') ? seedArg.split(':') : ['localhost', seedArg];
const port = parseInt(portStr, 10);

if (isNaN(port)) {
  console.error('Invalid port:', portStr);
  process.exit(1);
}

const seedAddress = `${host}:${port}`;
const client = new RaftClient();

(async () => {
  await client.initializeFromSeedNode(seedAddress);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> '
  });

  console.log('Raft CLI ready. Type "help" for commands.');
  rl.prompt();

  rl.on('line', async (line) => {
    const [cmd, ...args] = line.trim().split(/\s+/);
    if (!cmd) return rl.prompt();

    try {
      switch (cmd) {
        case 'set':
        case 'append':
          await client.sendCommand(cmd, args[0], args[1]);
          break;
        case 'get':
        case 'strln':
        case 'del':
          await client.sendCommand(cmd, args[0]);
          break;
        case 'add-member':
          await client.addMember(args[0]);
          break;
        case 'remove-member':
          await client.removeMember(args[0]);
          break;
        case 'peers':
          await client.getPeers();
          break;
        case 'status':
          await client.getNodeStatus(args[0]);
          break;
        case 'ping':
          await client.sendCommand(cmd);
          break;
        case 'exit':
          rl.close();
          return;
        case 'help':
          console.log(
            'Commands: set, get, del, append, strlen, add-member, remove-member, peers, status <addr>, exit'
          );
          break;
        default:
          console.log('Unknown command');
      }
    } catch (err) {
      console.log('Error:', err);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log('Exiting...');
    process.exit(0);
  });
})();
