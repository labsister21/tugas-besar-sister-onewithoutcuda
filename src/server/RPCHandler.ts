import jayson from 'jayson/promise';
import { raftNode } from './Server';
import { Request, Response } from 'express';

const server = new jayson.Server({
  requestVote: async ([params]: [any]) => {
    const { term, candidateId, candidateAddress, lastLogIndex, lastLogTerm } = params;
    if (
      typeof term !== 'number' ||
      typeof candidateId !== 'string' ||
      typeof candidateAddress !== 'string' ||
      typeof lastLogIndex !== 'number' ||
      typeof lastLogTerm !== 'number'
    ) {
      throw new Error('Invalid vote request format');
    }
    const voteGranted = raftNode.receiveVoteRequest(
      term,
      candidateId,
      candidateAddress,
      lastLogIndex,
      lastLogIndex
    );
    return { voteGranted };
  },

  appendEntries: async ([params]: [any]) => {
    const { entries, term, leaderId, leaderAddress, prevLogIndex, prevLogTerm, leaderCommit } =
      params;
    if (
      !Array.isArray(entries) ||
      typeof term !== 'number' ||
      typeof leaderId !== 'string' ||
      typeof leaderAddress !== 'string' ||
      typeof prevLogIndex !== 'number' ||
      typeof prevLogTerm !== 'number' ||
      typeof leaderCommit !== 'number'
    ) {
      throw new Error('Invalid append entries format');
    }

    const success = raftNode.receiveAppendEntries({
      term,
      leaderId,
      leaderAddress,
      entries,
      prevLogIndex,
      prevLogTerm,
      leaderCommit
    });

    return { success };
  }
});

export default (req: Request, res: Response) => {
  server.call(req.body, (err, response) => {
    if (err) res.status(400).json(err);
    else res.json(response);
  });
};
