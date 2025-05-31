import { Request, Response } from 'express';
import { raftNode } from './Server';

export const handlePing = (req: Request, res: Response) => {
  res.send('PONG');
};

export const handleClientCommand = async (req: Request, res: Response) => {
  const { command, key, value } = req.body;

  if (raftNode.getRole() !== 'LEADER') {
    res.status(403).json({
      error: 'Not leader',
      leader: raftNode.getLeaderId(),
      address: raftNode.getLeaderAddress() ?? ''
    });
    return;
  }

  if (typeof key !== 'string' || typeof command !== 'string') {
    res.status(400).json({ error: 'Invalid command structure' });
    return;
  }

  switch (command) {
    case 'set':
      raftNode.appendKVCommand(`set:${key}:${value}`);
      res.json({ result: 'OK' });
      return;
    case 'get':
      res.json({ result: `"${raftNode.getFromStore(key)}"` });
      return;
    case 'del':
      const oldValue = raftNode.getFromStore(key) ?? '';
      raftNode.appendKVCommand(`del:${key}`);
      res.json({ result: `"${oldValue}"` });
      return;
    case 'append':
      raftNode.appendKVCommand(`append:${key}:${value}`);
      res.json({ result: 'OK' });
      return;
    case 'strln':
      res.json({ result: raftNode.strlen(key) });
      return;
    default:
      res.status(400).json({ error: 'Unknown command' });
      return;
  }
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
