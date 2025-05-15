import readline from 'readline';
import { RaftClient } from './client/RaftClient';

const args = process.argv.slice(2);
if (args.length !== 1) {
  console.error('Usage: ts-node index-client.ts <seed-node>');
  process.exit(1);
}

const seedNode = args[0];
const client = new RaftClient();

(async () => {
  await client.initializeFromSeedNode(seedNode);

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
        case 'strlen':
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
