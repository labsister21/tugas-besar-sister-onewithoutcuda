import { startServer } from './server/Server'

const args = process.argv.slice(2)

if (args.length < 2) {
  console.error('Usage: npm run dev -- <nodeId> <port> [peers]')
  process.exit(1)
}

const id = args[0]
const port = parseInt(args[1], 10)
if (isNaN(port)) {
  console.error('Port must be a valid number.')
  process.exit(1)
}

const peers = args[2] ? args[2].split(',') : []

startServer(id, port, peers)
