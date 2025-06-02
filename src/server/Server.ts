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
  handleRemoveMember,
  handleRequestLog,
  handleShowHeartbeat,
  handleShutdown
} from './ClientHandler';
import { Server } from 'http';

export let raftNode: RaftNode;
export let server: Server;
export async function startServer(id: string, port: number, peers: string[], host: string) {
  const app = express();
  app.use(json());

  const kvStore = new KVStore();
  const logger = new Logger(id);
  const selfAddress = `${host}:${port}`;

  raftNode = new RaftNode(id, kvStore, logger, selfAddress);

  if (peers.length === 0) {
    raftNode.forceBootstrapSelf();
  } else {
    raftNode.initializeCluster(peers);
  }

  app.get('/ping', handlePing);

  app.get('/request_log', handleRequestLog);

  app.get('/status', (_, res) => {
    res.json({
      id,
      role: raftNode.getRole(),
      leader: raftNode.getLeaderId(),
      leaderAddress: raftNode.getLeaderAddress(),
      selfAddress: raftNode.getSelfAddress(),
      term: raftNode.getTerm(),
      peers: raftNode.getPeerIds(),
      logs: raftNode.getLogEntry(),
      store: raftNode.getKvStore()
    });
  });

  app.post('/join-cluster', handleJoinCluster);
  app.post('/remove-member', handleRemoveMember);
  app.post('/shutdown', handleShutdown);
  app.post('/toggle-heartbeat', handleShowHeartbeat);
  app.post('/execute', handleClientCommand);

  app.post('/rpc', rpcHandler);

  server = app.listen(port, () => {
    console.log(`[${new Date().toISOString()}][${id}] Node running on port ${port}`);
  });
}
