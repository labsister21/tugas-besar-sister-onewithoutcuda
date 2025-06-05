import { Request, Response } from 'express';
import { raftNode } from './Server';

export const handlePing = (req: Request, res: Response) => {
  if (raftNode.getRole() !== 'LEADER') {
    res.status(403).json({
      error: 'Not leader',
      leader: raftNode.getLeaderId(),
      address: raftNode.getLeaderAddress() ?? ''
    });
    return;
  }
  res.send('PONG');
};

export const handleRequestLog = (req: Request, res: Response) => {
  if (raftNode.getRole() !== 'LEADER') {
    res.status(403).json({
      error: 'Not leader',
      leader: raftNode.getLeaderId(),
      address: raftNode.getLeaderAddress() ?? ''
    });
    return;
  }
  res.json({
    logs: raftNode.getLogEntry()
  });
};

// export const handleClientCommand = async (req: Request, res: Response) => {
//   const { command, key, value } = req.body;

//   if (raftNode.getRole() !== 'LEADER') {
//     res.status(403).json({
//       error: 'Not leader',
//       leader: raftNode.getLeaderId(),
//       address: raftNode.getLeaderAddress() ?? ''
//     });
//     return;
//   }

//   if (typeof key !== 'string' || typeof command !== 'string') {
//     res.status(400).json({ error: 'Invalid command structure' });
//     return;
//   }

//   switch (command) {
//     case 'set':
//       raftNode.appendKVCommand(`set:${key}:${value}`);
//       res.json({ result: 'OK' });
//       return;
//     case 'get':
//       res.json({ result: raftNode.getFromStore(key) ?? '' });
//       return;
//     case 'del':
//       const oldValue = raftNode.getFromStore(key) ?? '';
//       raftNode.appendKVCommand(`del:${key}`);
//       res.json({ result: `"${oldValue}"` });
//       return;
//     case 'append':
//       const valueExisting = raftNode.getFromStore(key);
//       if (valueExisting === null) {
//         raftNode.appendKVCommand(`set:${key}:`);
//       }
//       raftNode.appendKVCommand(`append:${key}:${value}`);
//       res.json({ result: 'OK' });
//       return;
//     case 'strln':
//       res.json({ result: raftNode.strlen(key) });
//       return;
//     default:
//       res.status(400).json({ error: 'Unknown command' });
//       return;
//   }
// };

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

  if (typeof command !== 'string') {
    res.status(400).json({ error: 'Invalid command structure, command must be a string' });
    return;
  }

  if (['set', 'get', 'del', 'append', 'strln'].includes(command) && typeof key !== 'string') {
    res
      .status(400)
      .json({ error: `Invalid command structure, key must be a string for command '${command}'` });
    return;
  }

  try {
    switch (command) {
      case 'set':
        if (typeof value === 'undefined') {
          res.status(400).json({ error: 'Invalid command structure, value is required for set' });
          return;
        }
        const setResult = await raftNode.proposeCommand(`set:${key}:${value}`);
        if (setResult.success) {
          res.json({ result: 'OK' });
        } else {
          res.status(500).json({ error: setResult.error || 'Failed to apply set command' });
        }
        return;

      case 'get':
        res.json({ result: raftNode.getFromStore(key) ?? '' });
        return;

      case 'del':
        const oldValue = raftNode.getFromStore(key) ?? '';
        const delResult = await raftNode.proposeCommand(`del:${key}`);
        if (delResult.success) {
          res.json({ result: `"${oldValue}"` });
        } else {
          res.status(500).json({ error: delResult.error || 'Failed to apply del command' });
        }
        return;

      case 'append':
        if (typeof value === 'undefined') {
          res
            .status(400)
            .json({ error: 'Invalid command structure, value is required for append' });
          return;
        }

        const valueExisting = raftNode.getFromStore(key);
        if (valueExisting === null) {
          await raftNode.proposeCommand(`set:${key}:`);
        }
        const appendResult = await raftNode.proposeCommand(`append:${key}:${value}`);
        if (appendResult.success) {
          res.json({ result: 'OK' });
        } else {
          res.status(500).json({ error: appendResult.error || 'Failed to apply append command' });
        }
        return;

      case 'strln':
        res.json({ result: raftNode.strlen(key) });
        return;

      default:
        res.status(400).json({ error: 'Unknown command' });
        return;
    }
  } catch (error: any) {
    console.error(`Error processing command '${command}':`, error);
    res.status(500).json({
      error: error.message || `Failed to process command '${command}'`,
      leaderHint: { leaderId: raftNode.getLeaderId(), leaderAddress: raftNode.getLeaderAddress() }
    });
  }
};

export const handleJoinCluster = (req: Request, res: Response) => {
  const { address } = req.body;
  if (typeof address !== 'string') {
    res.status(400).json({ error: 'Invalid address format' });
    return;
  }

  if (raftNode.getRole() !== 'LEADER') {
    res.status(403).json({
      error: 'Not leader',
      leader: raftNode.getLeaderId(),
      address: raftNode.getLeaderAddress() ?? ''
    });
    return;
  }

  // raftNode.addPeer(address, true);
  // raftNode.appendAddMemberLog(address);
  // res.status(200).json({ success: true });

  const currentPeers = raftNode.getPeerIds();
  const newPeer = address;
  const combinedPeers = [...new Set([...currentPeers, newPeer, raftNode.getSelfAddress()])];
  const newPeers = [...new Set([...currentPeers, newPeer, raftNode.getSelfAddress()])];
  raftNode.beginJointConsensus(combinedPeers, newPeers);
  res.status(200).json({ success: true });
};

export const handleRemoveMember = (req: Request, res: Response) => {
  const { address } = req.body;

  if (typeof address !== 'string') {
    res.status(400).json({ error: 'Invalid address format' });
    return;
  }

  if (raftNode.getRole() !== 'LEADER') {
    res.status(403).json({
      error: 'Not leader',
      leader: raftNode.getLeaderId(),
      address: raftNode.getLeaderAddress() ?? ''
    });
    return;
  }

  // raftNode.appendRemoveMemberLog(address);
  // res.status(200).json({ success: true });
  const currentPeers = raftNode.getPeerIds();
  const deletePeer = address;
  const combinedPeers = [...new Set([...currentPeers, deletePeer, raftNode.getSelfAddress()])];
  const newPeers = combinedPeers.filter((p) => p !== address);
  raftNode.beginJointConsensus(combinedPeers, newPeers);
  res.status(200).json({ success: true });
};

export const handleShutdown = (req: Request, res: Response) => {
  res.status(200).send('Server will shut down');

  raftNode.shutdown();
};

export const handleShowHeartbeat = (req: Request, res: Response) => {
  const { visibility } = req.body as { visibility: boolean };

  raftNode.setHeartbeatVisibility(visibility);

  res.status(200).send('Updated heartbeat visibility');
};
