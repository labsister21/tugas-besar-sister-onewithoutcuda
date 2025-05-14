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

export let raftNode: RaftNode;

export function startServer(id: string, port: number, peers: string[]) {
  const app = express();
  app.use(json());

  const logger = new Logger(id);
  const selfAddress = `localhost:${port}`;

  raftNode = new RaftNode(id, peers, logger, selfAddress);

  if (peers.length === 0) {
    raftNode.forceBootstrapSelf();
  }

  app.get('/ping', (_, res) => {
    res.send('PONG');
  });

  app.get('/status', (_, res) => {
    res.json({
      id,
      role: raftNode.getRole(),
      leader: raftNode.getLeaderId(),
      term: raftNode.getTerm(),
      peers: raftNode.getPeerIds(),
      logs: raftNode.getLogEntry()
    });
  });

  app.get('/peers/status', (_, res) => {
    res.json(raftNode.getFailedPeerCounts());
  });

  app.post('/rpc/request-vote', handleRequestVote);
  app.post('/rpc/join-cluster', handleJoinCluster);
  app.post('/rpc/remove-member', handleRemoveMember);
  app.post('/rpc/append-entries', handleAppendEntries);

  app.listen(port, () => {
    console.log(`[${id}] Node running on port ${port}`);
  });
}
