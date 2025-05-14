import { Request, Response } from 'express';
import { raftNode } from './Server';

export const handleRequestVote = (req: Request, res: Response) => {
  const { term, candidateId } = req.body;
  if (typeof term !== 'number' || typeof candidateId !== 'string') {
    res.status(400).json({ error: 'Invalid vote request format' });
    return;
  }

  const voteGranted = raftNode.receiveVoteRequest(term, candidateId);
  res.status(200).json({ voteGranted });
};

export const handleJoinCluster = (req: Request, res: Response) => {
  const { address } = req.body;
  if (typeof address !== 'string') {
    res.status(400).json({ error: 'Invalid address format' });
    return;
  }

  if (raftNode.getRole() !== 'LEADER') {
    res.status(403).json({ error: 'Only leader can accept join requests' });
    return;
  }

  raftNode.addPeer(address, true);
  raftNode.appendAddMemberLog(address);
  res.status(200).json({ success: true });
};

export const handleRemoveMember = (req: Request, res: Response) => {
  const { address } = req.body;

  if (typeof address !== 'string') {
    res.status(400).json({ error: 'Invalid address format' });
    return;
  }

  if (raftNode.getRole() !== 'LEADER') {
    res.status(403).json({ error: 'Only leader can remove members' });
    return;
  }

  raftNode.appendRemoveMemberLog(address);
  res.status(200).json({ success: true });
};

export const handleAppendEntries = (req: Request, res: Response) => {
  const { entries, term, leaderId, leaderAddress, prevLogIndex, prevLogTerm, leaderCommit } =
    req.body;

  if (
    !Array.isArray(entries) ||
    typeof term !== 'number' ||
    typeof leaderId !== 'string' ||
    typeof leaderAddress !== 'string' ||
    typeof prevLogIndex !== 'number' ||
    typeof prevLogTerm !== 'number' ||
    typeof leaderCommit !== 'number'
  ) {
    res.status(400).json({ error: 'Invalid append entries format' });
    return;
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

  res.status(200).json({ success });
};
