import express from 'express';
import { json } from 'body-parser';
import { KVStore } from '../kvstore/KVStore';
import { Logger } from '../utils/Logger';
import { RaftNode } from '../raft/RaftNode';
import {
  handleRequestVote,
  handleJoinCluster,
  handleRemoveMember,
  handleAppendEntries
} from './RPCHandler';
import { handleClientCommand, handlePing } from './ClientHandler';

export let raftNode: RaftNode;

export function startServer(id: string, port: number, peers: string[]) {
  const app = express();
  app.use(json());

  const kvStore = new KVStore();
  const logger = new Logger(id);
  const selfAddress = `localhost:${port}`;

  raftNode = new RaftNode(id, kvStore, peers, logger, selfAddress);

  if (peers.length === 0) {
    raftNode.forceBootstrapSelf();
  }

  app.get('/ping', handlePing);

  app.get('/status', (_, res) => {
    res.json({
      id,
      role: raftNode.getRole(),
      leader: raftNode.getLeaderId(),
      term: raftNode.getTerm(),
      peers: raftNode.getPeerIds(),
      logs: raftNode.getLogEntry(),
      store: raftNode.getKvStore()
    });
  });

  app.post('/rpc/request-vote', handleRequestVote);
  app.post('/rpc/join-cluster', handleJoinCluster);
  app.post('/rpc/remove-member', handleRemoveMember);
  app.post('/rpc/append-entries', handleAppendEntries);

  app.post('/rpc/execute', handleClientCommand);

  app.listen(port, () => {
    console.log(`[${id}] Node running on port ${port}`);
  });
}
