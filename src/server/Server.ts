import express from 'express';
import { json } from 'body-parser';
import { KVStore } from '../kvstore/KVStore';
import { Logger } from '../utils/Logger';
import { RaftNode } from '../raft/RaftNode';
import rpcHandler from './RPCHandler';
import {
  handleClientCommand,
  handleJoinCluster,
  handlePing,
  handleRemoveMember
} from './ClientHandler';

export let raftNode: RaftNode;

export function startServer(id: string, port: number, peers: string[], host: string) {
  const app = express();
  app.use(json());

  const kvStore = new KVStore();
  const logger = new Logger(id);
  const selfAddress = `${host}:${port}`;

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
      selfAddress: raftNode.getSelfAddress(),
      term: raftNode.getTerm(),
      peers: raftNode.getPeerIds(),
      logs: raftNode.getLogEntry(),
      store: raftNode.getKvStore()
    });
  });

  app.post('/join-cluster', handleJoinCluster);
  app.post('/remove-member', handleRemoveMember);
  app.post('/execute', handleClientCommand);

  app.post('/rpc', rpcHandler);

  app.listen(port, () => {
    console.log(`[${id}] Node running on port ${port}`);
  });
}
