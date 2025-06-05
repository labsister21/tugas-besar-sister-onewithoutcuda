import { RaftNode } from '../raft/RaftNode';
import { KVStore } from '../kvstore/KVStore';
import { Logger } from '../utils/Logger';
import { LogEntry, NodeRole } from '../types/raft';

jest.mock('../kvstore/KVStore');
jest.mock('../utils/Logger');
jest.mock('axios'); 

jest.mock('../server/Server', () => ({
  ...jest.requireActual('../server/Server'), 
  server: {
    close: jest.fn((callback) => {
      if (callback) callback();
    })
  }
}));

import axios from 'axios';
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('RaftNode', () => {
  let raftNode: RaftNode;
  let mockKvStore: jest.Mocked<KVStore>;
  let mockLogger: jest.Mocked<Logger>;
  const selfId = 'node1';
  const selfAddress = 'localhost:8081';

  let setTimeoutSpy: jest.SpyInstance;
  let clearTimeoutSpy: jest.SpyInstance;
  let setIntervalSpy: jest.SpyInstance;
  let mathRandomSpy: jest.SpyInstance;

  const addTestHelpers = (node: RaftNode) => {
    (node as any).setTermForTest = (term: number) => {
      (node as any).term = term;
    };
    (node as any).getVotedForForTest = () => (node as any).votedFor;
    (node as any).getCommitIndexForTest = () => (node as any).commitIndex;
    (node as any).setLogForTest = (log: LogEntry[]) => {
      (node as any).log = [...log];
      (node as any).commitIndex = log.length > 0 ? log.length - 1 : -1;
      (node as any).lastApplied = (node as any).commitIndex;
    };
    (node as any).applyLogEntryForTest = (entry: LogEntry) => {
      (node as any).applyLogEntry(entry);
    };
    (node as any).becomeLeaderForTest = () => {
      const raftNodeInstance = node as any;
      if (raftNodeInstance.term === 0) {
        raftNodeInstance.term = 1;
      }
      raftNodeInstance.role = 'LEADER';
      raftNodeInstance.leaderId = raftNodeInstance.id;
      raftNodeInstance.leaderAddress = raftNodeInstance.selfAddress;
      raftNodeInstance.logger.log(`Became LEADER for term ${raftNodeInstance.term}`);
      for (const peer of raftNodeInstance.peers) {
        raftNodeInstance.nextIndex.set(peer, raftNodeInstance.log.length);
        raftNodeInstance.matchIndex.set(peer, -1);
      }
      (raftNodeInstance as any).startHeartbeat(); 
    };
    (node as any).getShowHeartbeatForTest = () => (node as any).showHeartbeat;
  };

  beforeEach(() => {
    jest.useFakeTimers();

    setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
    setIntervalSpy = jest.spyOn(global, 'setInterval');

    mathRandomSpy = jest.spyOn(global.Math, 'random').mockReturnValue(0);

    mockKvStore = new KVStore() as jest.Mocked<KVStore>;
    mockLogger = new Logger(selfId) as jest.Mocked<Logger>;
    raftNode = new RaftNode(selfId, mockKvStore, mockLogger, selfAddress);
    addTestHelpers(raftNode); 
  });

  afterEach(() => {
    jest.clearAllMocks(); 
    mathRandomSpy.mockRestore();

    setTimeoutSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
    setIntervalSpy.mockRestore();
    jest.useRealTimers();
    jest.clearAllTimers(); 
  });

  test('should initialize as FOLLOWER with term 0', () => {
    expect(raftNode.getRole()).toBe('FOLLOWER');
    expect(raftNode.getTerm()).toBe(0);
    expect(raftNode.getLeaderId()).toBeNull();
  });

  test('should start election timeout on initialization', () => {
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
  });

  describe('Election Logic', () => {
    test('isolated node should become LEADER after election timeout', async () => {
      jest.advanceTimersByTime(401); 
      await Promise.resolve();

      expect(mockLogger.log).toHaveBeenCalledWith('Election timeout — assuming leader is dead');
      expect(mockLogger.log).toHaveBeenCalledWith('Starting election for term 1');
      expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('Vote granted: 1/1'));
      expect(mockLogger.log).toHaveBeenCalledWith('Achieved majority vote, becoming LEADER');
      expect(mockLogger.log).toHaveBeenCalledWith('Became LEADER for term 1');

      expect(raftNode.getRole()).toBe('LEADER');
      expect(raftNode.getTerm()).toBe(1);
    });

    test('receiveVoteRequest: should grant vote if term is newer and not voted', () => {
      raftNode.addPeer('localhost:8082', true);
      const result = raftNode.receiveVoteRequest(1, 'candidate2', 'localhost:8082', 0, 0);
      expect(result).toBe(true);
      expect(raftNode.getTerm()).toBe(1);
      expect(mockLogger.log).toHaveBeenCalledWith(
        'Voted for candidate2 in term 1 (Log up-to-date check passed)'
      );
      expect(raftNode.getRole()).toBe('FOLLOWER');
    });

    test('receiveVoteRequest: should deny vote if term is older', () => {
      raftNode.setTermForTest(2);
      raftNode.addPeer('localhost:8082', true);
      const result = raftNode.receiveVoteRequest(1, 'candidate2', 'localhost:8082', 0, 0);
      expect(result).toBe(false);
    });

    test('receiveVoteRequest: should deny vote if already voted in current term', () => {
      raftNode.addPeer('localhost:8082', true);
      raftNode.addPeer('localhost:8083', true);
      raftNode.receiveVoteRequest(1, 'candidate2', 'localhost:8082', 0, 0);
      const result = raftNode.receiveVoteRequest(1, 'candidate3', 'localhost:8083', 0, 0);
      expect(result).toBe(false);
    });

    test('receiveVoteRequest: should grant vote if term is newer, even if voted in older term', () => {
      raftNode.addPeer('localhost:8082', true);
      raftNode.addPeer('localhost:8083', true);
      raftNode.receiveVoteRequest(1, 'candidate2', 'localhost:8082', 0, 0);
      const result = raftNode.receiveVoteRequest(2, 'candidate3', 'localhost:8083', 0, 0);
      expect(result).toBe(true);
      expect(raftNode.getTerm()).toBe(2);
      expect(mockLogger.log).toHaveBeenCalledWith(
        'Voted for candidate3 in term 2 (Log up-to-date check passed)'
      );
    });

    test('receiveVoteRequest: should not grant vote to unknown peer', () => {
      const result = raftNode.receiveVoteRequest(1, 'unknownCandidate', 'unknown:1234', 0, 0);
      expect(result).toBe(false);
    });

  });

  describe('AppendEntries Logic', () => {
    test('receiveAppendEntries: should accept heartbeat and reset election timeout', () => {
      raftNode.setTermForTest(1);
      const params = {
        term: 1,
        leaderId: 'leader1',
        leaderAddress: 'localhost:8080',
        entries: [],
        prevLogIndex: -1,
        prevLogTerm: 0,
        leaderCommit: -1
      };
      const result = raftNode.receiveAppendEntries(params);
      expect(result).toBe(true);
      expect(raftNode.getRole()).toBe('FOLLOWER');
      expect(raftNode.getLeaderId()).toBe('leader1');
      expect(raftNode.getLeaderAddress()).toBe('localhost:8080');
      expect(clearTimeout).toHaveBeenCalled(); 
      expect(setTimeout).toHaveBeenCalledTimes(2); 
    });

    test('receiveAppendEntries: should deny if term is older', () => {
      raftNode.setTermForTest(2);
      const params = {
        term: 1,
        leaderId: 'leader1',
        leaderAddress: 'localhost:8080',
        entries: [],
        prevLogIndex: -1,
        prevLogTerm: 0,
        leaderCommit: -1
      };
      const result = raftNode.receiveAppendEntries(params);
      expect(result).toBe(false);
    });

    test('receiveAppendEntries: should append new entries and update commitIndex', () => {
      const entry1: LogEntry = { term: 1, command: 'set:key1:val1' };
      const params = {
        term: 1,
        leaderId: 'leader1',
        leaderAddress: 'localhost:8080',
        entries: [entry1],
        prevLogIndex: -1,
        prevLogTerm: 0,
        leaderCommit: 0
      };
      const result = raftNode.receiveAppendEntries(params);
      expect(result).toBe(true);
      expect(raftNode.getLogEntry()).toEqual([entry1]);
      expect(raftNode.getCommitIndexForTest()).toBe(0); 
      expect(mockKvStore.set).toHaveBeenCalledWith('key1', 'val1'); 
    });

    test('receiveAppendEntries: should reject if prevLogTerm does not match', () => {
      const initialEntry: LogEntry = { term: 1, command: 'set:a:b' };
      raftNode.setLogForTest([initialEntry]); 
      raftNode.setTermForTest(1);

      const newEntry: LogEntry = { term: 1, command: 'set:c:d' };
      const params = {
        term: 1,
        leaderId: 'leader1',
        leaderAddress: 'localhost:8080',
        entries: [newEntry],
        prevLogIndex: 0,
        prevLogTerm: 0, 
        leaderCommit: 0
      };
      const result = raftNode.receiveAppendEntries(params);
      expect(result).toBe(false);
      expect(raftNode.getLogEntry()).toEqual([initialEntry]); 
      expect(mockKvStore.set).not.toHaveBeenCalledWith('c', 'd');
    });
  });

  describe('Log Application', () => {
    test('applyLogEntry: should apply "set" command to KVStore', () => {
      const entry: LogEntry = { term: 1, command: 'set:mykey:myvalue' };
      raftNode.applyLogEntryForTest(entry); 
      expect(mockKvStore.set).toHaveBeenCalledWith('mykey', 'myvalue');
      expect(mockLogger.log).toHaveBeenCalledWith('Applied log: set mykey = myvalue');
    });

    test('applyLogEntry: should apply "del" command to KVStore', () => {
      const entry: LogEntry = { term: 1, command: 'del:mykey' };
      raftNode.applyLogEntryForTest(entry);
      expect(mockKvStore.del).toHaveBeenCalledWith('mykey');
      expect(mockLogger.log).toHaveBeenCalledWith('Applied log: del mykey');
    });

    test('applyLogEntry: should apply "append" command to KVStore', () => {
      const entry: LogEntry = { term: 1, command: 'append:mykey:suffix' };
      raftNode.applyLogEntryForTest(entry);
      expect(mockKvStore.append).toHaveBeenCalledWith('mykey', 'suffix');
      expect(mockLogger.log).toHaveBeenCalledWith('Applied log: append mykey += suffix');
    });
  });

  describe('Leadership & Heartbeats', () => {
    test('becomeLeader: should transition to LEADER, set leaderId, and start heartbeat', () => {
      raftNode.becomeLeaderForTest(); 

      expect(raftNode.getRole()).toBe('LEADER');
      expect(raftNode.getLeaderId()).toBe(selfId);
      expect(raftNode.getLeaderAddress()).toBe(selfAddress);
      expect(mockLogger.log).toHaveBeenCalledWith(`Became LEADER for term 1`);
      expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 100); 
    });

    test('startHeartbeat: should send appendEntries to peers', async () => {
      raftNode.addPeer('peer2:8082', false);
      raftNode.becomeLeaderForTest();
      mockedAxios.post.mockResolvedValue({ data: { result: { success: true } } });

      jest.advanceTimersByTime(100); 

      await Promise.resolve();

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://peer2:8082/rpc',
        expect.objectContaining({
          method: 'appendEntries',
          params: [
            expect.objectContaining({
              term: raftNode.getTerm(),
              leaderId: selfId,
              entries: []
            })
          ]
        })
      );
      expect(raftNode.getShowHeartbeatForTest()).toBe(false); 
    });

    test('startHeartbeat: should show heartbeat logs if showHeartbeat is true', async () => {
      raftNode.addPeer('peer2:8082', false);
      raftNode.setHeartbeatVisibility(true);
      expect(raftNode.getShowHeartbeatForTest()).toBe(true);
      raftNode.becomeLeaderForTest();
      mockedAxios.post.mockResolvedValue({ data: { result: { success: true } } });

      jest.advanceTimersByTime(100);
      await Promise.resolve();

      expect(mockLogger.log).toHaveBeenCalledWith(
        'Heartbeat: No new entries to send to peer2:8082'
      );
    });
  });

  describe('Shutdown', () => {
    test('shutdown: should call server.close and exit process after a delay', () => {
      const mockExit = jest.spyOn(process, 'exit').mockImplementation((() => {}) as any);
      raftNode.shutdown();

      expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 100);
      jest.advanceTimersByTime(100); 

      expect(mockLogger.log).toHaveBeenCalledWith('Shutting down...');
      expect(require('../server/Server').server.close).toHaveBeenCalledTimes(1);
 
      const closeCallback = (require('../server/Server').server.close as jest.Mock).mock
        .calls[0][0];
      closeCallback(); // Manually invoke the callback
      expect(mockLogger.log).toHaveBeenCalledWith('Server closed');
      expect(mockExit).toHaveBeenCalledWith(0);

      mockExit.mockRestore();
    });
  });
});
