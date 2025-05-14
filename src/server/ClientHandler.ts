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
      res.json({ result: raftNode.getFromStore(key) });
      return;
    case 'del':
      raftNode.appendKVCommand(`del:${key}`);
      res.json({ result: 'OK' });
      return;
    case 'append':
      raftNode.appendKVCommand(`append:${key}:${value}`);
      res.json({ result: 'OK' });
      return;
    case 'strlen':
      res.json({ result: raftNode.strlen(key) });
      return;
    default:
      res.status(400).json({ error: 'Unknown command' });
      return;
  }
};
