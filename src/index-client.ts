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
        case 'request-log':
          await client.getLog();
          break;
        case 'status-client':
          await client.showClientData();
          break;
        case 'refresh-client':
          await client.refreshStatus();
          break;
        case 'show-heartbeat':
          await client.setHeartbeat(true);
          break;
        case 'hide-heartbeat':
          await client.setHeartbeat(false);
          break;
        case 'set-leader':
          await client.setLeaderAddress(args[0]);
          break;
        case 'ping':
          await client.ping();
          break;
        case 'exit':
          rl.close();
          return;
        case 'help':
          console.log(`
Available Commands:
  set <key> <value>         Set a key to a value
  get <key>                 Get the value of a key
  del <key>                 Delete a key
  append <key> <value>      Append a value to a key
  strln <key>              Get length of value stored in a key
          
Cluster Management:
  add-member <host:port>    Add a new node to the cluster
  remove-member <host:port> Remove a node from the cluster
  peers                     Show current known peers
          
Monitoring & Debugging:
  status [host:port]        Get status of a node
  request-log               Get log entries from leader node
  ping                      Ping the leader node
          
Other:
  help                      Show this help menu
  exit                      Exit the CLI
  status-client             Show current client data
  refresh-client            Refresh client data from the leader
  set-leader <host:port>    Set the current leader address
  show-heartbeat            Show heartbeat visibility (in log server)
  hide-heartbeat            Hide heartbeat visibility (in log server)
        `);
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
