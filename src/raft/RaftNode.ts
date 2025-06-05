import axios from 'axios';
import { KVStore } from '../kvstore/KVStore';
import { Logger } from '../utils/Logger';
import { LogEntry, NodeRole } from '../types/raft';
import { server } from '../server/Server';

export class RaftNode {
  private role: NodeRole = 'FOLLOWER';
  private term = 0;
  private votedFor: string | null = null;
  private log: LogEntry[] = [];
  private commitIndex = -1;
  private leaderId: string | null = null;
  private leaderAddress: string | null = null;
  private lastApplied = -1;

  private electionTimeout?: NodeJS.Timeout;
  private heartbeatInterval?: NodeJS.Timeout;
  private peers: Set<string> = new Set();
  private configStage: 'stable' | 'joint' | 'new' = 'stable';
  private jointConfig: Set<string> = new Set();
  private newConfig: Set<string> = new Set();

  private failedPeerCounts: Map<string, number> = new Map();
  private readonly MAX_FAILED_HEARTBEATS = 10;

  private nextIndex: Map<string, number> = new Map();
  private matchIndex: Map<string, number> = new Map();

  private readonly BASE_ELECTION_TIMEOUT_MIN = 400;
  private readonly BASE_ELECTION_TIMEOUT_MAX = 800;
  private electionBackoffMultiplier = 1;

  private showHeartbeat: boolean = false;

  constructor(
    private readonly id: string,
    private readonly kvStore: KVStore,
    private readonly logger: Logger,
    private readonly selfAddress: string
  ) {
    this.peers = new Set();
    this.startElectionTimeout();
  }

  private startElectionTimeout() {
    this.clearTimeouts();
    const min = this.BASE_ELECTION_TIMEOUT_MIN * this.electionBackoffMultiplier;
    const max = this.BASE_ELECTION_TIMEOUT_MAX * this.electionBackoffMultiplier;
    const timeout = min + Math.random() * (max - min);
    // const timeout = 150 + Math.random() * 150;

    // this.logger.log(
    //   `Starting election timeout: ${Math.floor(timeout)}ms)`
    // );

    this.electionTimeout = setTimeout(() => {
      this.logger.log(`Election timeout — assuming leader is dead`);
      this.startElection();
    }, timeout);
  }

  private startElection() {
    this.role = 'CANDIDATE';
    this.term += 1;
    this.votedFor = this.id;
    this.logger.log(`Starting election for term ${this.term}`);
    this.requestVotes();
  }

  public receiveVoteRequest(
    term: number,
    candidateId: string,
    candidateAddress: string,
    candidateLastLogIndex: number, // PARAMETER BARU
    candidateLastLogTerm: number // PARAMETER BARU
  ): boolean {
    if (!this.peers.has(candidateAddress)) {
      return false;
    }
    if (term < this.term) return false;

    if (term > this.term) {
      this.term = term;
      this.votedFor = null;
      this.role = 'FOLLOWER';
    }

    const myLastLogIndex = this.log.length - 1;
    const myLastLogTerm = myLastLogIndex >= 0 ? this.log[myLastLogIndex].term : 0;

    let voteGranted = false;
    if (candidateLastLogTerm > myLastLogTerm) {
      voteGranted = true;
    } else if (candidateLastLogTerm === myLastLogTerm) {
      if (candidateLastLogIndex >= myLastLogIndex) {
        voteGranted = true;
      }
    }

    if (voteGranted && (this.votedFor === null || this.votedFor === candidateId)) {
      this.votedFor = candidateId;
      this.startElectionTimeout();
      this.logger.log(`Voted for ${candidateId} in term ${term} (Log up-to-date check passed)`);
      return true;
    }

    this.logger.log(
      `Denied vote for ${candidateId} in term ${term}. ` +
        `MyLastLogTerm: ${myLastLogTerm}, CandLastLogTerm: ${candidateLastLogTerm}. ` +
        `MyLastLogIndex: ${myLastLogIndex}, CandLastLogIndex: ${candidateLastLogIndex}. ` +
        `VotedFor: ${this.votedFor}, VoteGrantedSoFar: ${voteGranted}`
    );
    return false;
  }

  private becomeLeader() {
    this.role = 'LEADER';
    this.leaderAddress = this.selfAddress;
    this.leaderId = this.id;
    this.logger.log(`Became LEADER for term ${this.term}`);

    for (const peer of this.peers) {
      this.nextIndex.set(peer, this.log.length);
      this.matchIndex.set(peer, -1);
    }

    // this.log.push({ term: this.term, command: 'no-op' });
    // this.logger.log(
    //   `Appended no-op entry for term ${this.term} upon becoming leader. Log length is now ${this.log.length}.`
    // );

    this.startHeartbeat();
  }

  public setHeartbeatVisibility(isShowing: boolean) {
    this.showHeartbeat = isShowing;
  }

  private startHeartbeat() {
    this.clearTimeouts();
    this.heartbeatInterval = setInterval(() => {
      for (const peer of this.peers) {
        const next = this.nextIndex.get(peer) ?? this.log.length;
        const prevLogIndex = next - 1;
        const prevLogTerm = this.log[prevLogIndex]?.term ?? 0;
        const entries = this.log.slice(next);

        if (entries.length > 0) {
          this.logger.log(`Heartbeat: Sending ${entries.length} log entries to ${peer}`);
          console.log('before:', next);
        } else {
          if (this.showHeartbeat) {
            this.logger.log(`Heartbeat: No new entries to send to ${peer}`);
          }
        }

        axios
          .post(
            `http://${peer}/rpc`,
            {
              jsonrpc: '2.0',
              method: 'appendEntries',
              params: [
                {
                  term: this.term,
                  leaderId: this.id,
                  leaderAddress: this.selfAddress,
                  prevLogIndex,
                  prevLogTerm,
                  entries,
                  leaderCommit: this.commitIndex
                }
              ],
              id: 1
            },
            // { timeout: 200 }
          )
          .then((res) => {
            this.failedPeerCounts.set(peer, 0);
            if (res.data.result?.success) {
              this.nextIndex.set(peer, next + entries.length);
              this.matchIndex.set(peer, next + entries.length - 1);
              this.checkCommit();
            } else {
              this.nextIndex.set(peer, Math.max(0, next - 1));
            }
          })
          .catch(() => {
            const fails = (this.failedPeerCounts.get(peer) || 0) + 1;
            this.failedPeerCounts.set(peer, fails);
            if (fails === this.MAX_FAILED_HEARTBEATS) {
              this.logger.log(`Peer ${peer} is likely down (missed ${fails} heartbeats)`);
              // this.nextIndex.set(peer, 0);
              // this.matchIndex.set(peer, -1);
            }
          });
      }
    }, 100);
  }

  private clearTimeouts() {
    if (this.electionTimeout) clearTimeout(this.electionTimeout);
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
  }

  public beginJointConsensus(combinedPeers: string[], newPeers: string[]) {
    const combined = new Set([...combinedPeers]);
    const entry = {
      term: this.term,
      command: `config:joint:${[...combined].join(',')}|${newPeers.join(',')}`
    };
    this.log.push(entry);
    if (this.peers.size === 0) {
      this.checkCommit();
    } else {
      this.sendAppendEntriesNow();
    }
  }

  public finalizeNewConfig(newPeers: string[]) {
    const entry = {
      term: this.term,
      command: `config:new:${[...newPeers].join(',')}`
    };
    const deletedPeers = [...this.peers, this.selfAddress].filter((p) => !newPeers.includes(p));
    this.log.push(entry);
    this.sendAppendEntriesNow();
    this.shutdownRemovedMember(deletedPeers);
  }

  public async shutdownRemovedMember(address: string[]) {
    for (const addr of address) {
      if (addr !== this.selfAddress) {
        axios.post(`http://${addr}/shutdown`).then((res) => {
          this.logger.log(`Shutdown request sent to ${addr}: ${res.status}`);
        });
      }
    }
  }

  public shutdown() {
    setTimeout(() => {
      this.logger.log('Shutting down...');
      server.close(() => {
        this.logger.log('Server closed');
        process.exit(0);
      });
    }, 100);
  }

  private applyLogEntry(entry: LogEntry) {
    const [cmd, ...args] = entry.command.split(':');
    const peer = args.join(':');

    // if (cmd === 'initMember') {
    //   if (peer !== this.selfAddress && !this.peers.has(peer)) {
    //     this.peers.add(peer);
    //     this.logger.log(`Applied log: addMember ${peer}`);
    //   }
    // }

    // if (cmd === 'removeMember') {
    //   console.log('remove-member: ', peer, this.selfAddress, peer === this.selfAddress);

    //   if (peer === this.selfAddress) {
    //     this.logger.log(`I am being removed from cluster — stepping down.`);
    //     this.peers.clear();
    //     this.nextIndex.clear();
    //     this.matchIndex.clear();
    //     this.failedPeerCounts.clear();
    //     this.role = 'FOLLOWER';
    //     this.leaderId = null;
    //     this.leaderAddress = null;
    //     this.clearTimeouts();
    //     return;
    //   }
    //   if (this.peers.delete(peer)) {
    //     this.nextIndex.delete(peer);
    //     this.matchIndex.delete(peer);
    //     this.failedPeerCounts.delete(peer);
    //     if (this.leaderAddress === peer) {
    //       this.leaderId = null;
    //       this.leaderAddress = null;
    //       this.logger.log(`Leader ${peer} removed, resetting leader state`);
    //     }
    //     this.logger.log(`Applied log: removeMember ${peer}`);
    //   }
    // }
    if (cmd === 'no-op') {
      this.logger.log(`Applied log: no-op (term: ${entry.term}, index: ${this.lastApplied})`);
    } else if (cmd === 'config') {
      const [stage, ...peers] = args;
      const peersStr = peers.join(':');

      if (stage === 'joint') {
        const [combinedPeers, newPeers] = peersStr.split('|');
        const combinedP = new Set(combinedPeers.split(','));
        const newP = new Set(newPeers.split(','));
        this.configStage = 'joint';
        this.jointConfig = combinedP;
        this.newConfig = newP;
        for (const peer of combinedP) {
          if (!this.peers.has(peer) && peer !== this.selfAddress) {
            this.nextIndex.set(peer, 0);
            this.matchIndex.set(peer, -1);
            this.failedPeerCounts.set(peer, 0);
          }
        }
        this.peers = new Set([...combinedP].filter((p) => p !== this.selfAddress));
        this.logger.log(`Entered JOINT consensus with peers: ${[...combinedP].join(', ')}`);
      } else if (stage === 'new') {
        const newP = new Set(peersStr.split(','));
        this.configStage = 'stable';
        for (const peer of this.peers) {
          if (!newP.has(peer) && peer !== this.selfAddress) {
            this.nextIndex.delete(peer);
            this.matchIndex.delete(peer);
            this.failedPeerCounts.delete(peer);
          }
        }
        this.peers = new Set([...newP].filter((p) => p !== this.selfAddress));

        this.logger.log(`Committed NEW config with peers: ${[...newP].join(', ')}`);
        if (
          this.configStage === 'stable' &&
          this.jointConfig.has(this.selfAddress) &&
          !newP.has(this.selfAddress) &&
          this.lastApplied >= this.commitIndex
        ) {
          this.logger.log(`This node is removed from cluster. Preparing to shut down.`);
          setTimeout(() => this.shutdown(), 100);
        }
        this.jointConfig.clear();
        this.newConfig.clear();
      }
    } else if (cmd === 'set') {
      const [k, v] = args.join(':').split(':');
      this.kvStore.set(k, v);
      this.logger.log(`Applied log: set ${k} = ${v}`);
    } else if (cmd === 'del') {
      const key = args.join(':');
      this.kvStore.del(key);
      this.logger.log(`Applied log: del ${key}`);
    } else if (cmd === 'append') {
      const [k, v] = args.join(':').split(':');
      this.kvStore.append(k, v);
      this.logger.log(`Applied log: append ${k} += ${v}`);
    }
  }

  private checkCommit() {
    const match = [...this.matchIndex.values()];
    match.push(this.log.length - 1);
    match.sort((a, b) => b - a);

    const N = match[Math.floor(match.length / 2)];
    if (N > this.commitIndex && this.log[N]?.term === this.term) {
      this.commitIndex = N;
      this.logger.log(`Log committed up to index ${N}`);
    }

    while (this.lastApplied < this.commitIndex) {
      this.lastApplied++;
      const entry = this.log[this.lastApplied];
      this.logger.log(`Applying log at index ${this.lastApplied}: ${entry.command}`);

      this.applyLogEntry(entry);
      if (entry.command.startsWith('config:joint:')) {
        const [cmd, state, ...peers] = entry.command.split(':');
        const peersCsv = peers.join(':');
        const [combinedP, newP] = peersCsv.split('|');
        const newPeers = newP.split(',');
        this.finalizeNewConfig(newPeers);
      }
    }
  }

  public addPeer(address: string, isNewJoin = false) {
    if (!this.peers.has(address) && address !== this.selfAddress) {
      this.peers.add(address);
      this.nextIndex.set(address, isNewJoin ? 0 : this.log.length);
      this.matchIndex.set(address, -1);
      this.failedPeerCounts.set(address, 0);
      this.logger.log(`Peer manually added: ${address}`);
    }
  }

  public forceBootstrapSelf() {
    // this.log.push({ term: this.term, command: `initMember:${this.selfAddress}` });
    this.log.push({
      term: this.term,
      command: `config:joint:${this.selfAddress}|${this.selfAddress}`
    });
    this.log.push({
      term: this.term,
      command: `config:new:${this.selfAddress}`
    });
    this.commitIndex = this.log.length - 1;
    this.logger.log(`Bootstrapping self as single-node cluster at ${this.selfAddress}`);

    while (this.lastApplied < this.commitIndex) {
      this.lastApplied++;
      this.applyLogEntry(this.log[this.lastApplied]);
    }
  }

  public initializeCluster(peers: string[]) {
    const allPeers = new Set([...peers, this.selfAddress].sort());

    // for (const peer of allPeers) {
    //   this.log.push({ term: this.term, command: `initMember:${peer}` });
    // }
    this.log.push({
      term: this.term,
      command: `config:joint:${[...allPeers].join(',')}|${[...allPeers].join(',')}`
    });

    this.log.push({
      term: this.term,
      command: `config:new:${[...allPeers].join(',')}`
    });

    this.commitIndex = this.log.length - 1;
    this.logger.log(`Initialized cluster with peers: ${Array.from(allPeers).join(', ')}`);

    while (this.lastApplied < this.commitIndex) {
      this.lastApplied++;
      this.applyLogEntry(this.log[this.lastApplied]);
    }
  }

  // public appendAddMemberLog(address: string) {
  //   this.log.push({ term: this.term, command: `addMember:${address}` });

  //   if (!this.peers.has(address) && address !== this.selfAddress) {
  //     this.peers.add(address);
  //     this.nextIndex.set(address, this.log.length);
  //     this.matchIndex.set(address, -1);
  //   }

  //   this.sendAppendEntriesNow();
  // }

  private sendAppendEntriesNow() {
    for (const peer of this.peers) {
      const next = this.nextIndex.get(peer) ?? this.log.length;
      const prevLogIndex = next - 1;
      const prevLogTerm = this.log[prevLogIndex]?.term ?? 0;
      const entries = this.log.slice(next);

      if (entries.length > 0) {
        this.logger.log(`Sending ${entries.length} log entries to ${peer}`);
      }

      axios
        .post(
          `http://${peer}/rpc`,
          {
            jsonrpc: '2.0',
            method: 'appendEntries',
            params: [
              {
                term: this.term,
                leaderId: this.id,
                leaderAddress: this.selfAddress,
                prevLogIndex,
                prevLogTerm,
                entries,
                leaderCommit: this.commitIndex
              }
            ],
            id: 1
          },
          // { timeout: 200 }
        )
        .then((res) => {
          this.failedPeerCounts.set(peer, 0);
          if (res.data.result?.success) {
            this.nextIndex.set(peer, next + entries.length);
            this.matchIndex.set(peer, next + entries.length - 1);
            this.checkCommit();
          } else {
            this.nextIndex.set(peer, Math.max(0, next - 1));
          }
        })
        .catch(() => {
          const fails = (this.failedPeerCounts.get(peer) || 0) + 1;
          this.failedPeerCounts.set(peer, fails);
          if (fails === this.MAX_FAILED_HEARTBEATS) {
            this.logger.log(`Peer ${peer} is likely down (missed ${fails} heartbeats)`);
            // this.nextIndex.set(peer, 0);
            // this.matchIndex.set(peer, -1);
          }
        });
    }
  }

  // public appendRemoveMemberLog(address: string) {
  //   this.log.push({ term: this.term, command: `removeMember:${address}` });

  //   this.logger.log(`Queued removeMember:${address} → log length now ${this.log.length}`);

  //   this.sendAppendEntriesNow();
  // }

  public receiveAppendEntries(params: {
    term: number;
    leaderId: string;
    leaderAddress: string;
    entries: LogEntry[];
    prevLogIndex: number;
    prevLogTerm: number;
    leaderCommit: number;
  }): boolean {
    const { term, leaderId, leaderAddress, entries, prevLogIndex, prevLogTerm, leaderCommit } =
      params;

    if (term < this.term) return false;

    this.startElectionTimeout();

    if (entries.length > 0) {
      this.logger.log(
        `Received ${entries.length} entries from ${leaderId} (${leaderAddress}) for term ${term}`
      );
    } else if (entries.length === 0 && this.showHeartbeat) {
      this.logger.log(`Received heartbeat from ${leaderId} (${leaderAddress}) for term ${term}`);
    }

    if (prevLogIndex === -1) {
      this.votedFor = null;
      this.log = [];
      this.commitIndex = -1;
      this.nextIndex.clear();
      this.matchIndex.clear();
      this.failedPeerCounts.clear();
      this.lastApplied = -1;
      this.peers.clear();
      this.logger.log(`Reset state from join. Now following ${leaderId} (${leaderAddress})`);
    }

    this.term = term;
    this.leaderId = leaderId;
    this.leaderAddress = leaderAddress;
    this.role = 'FOLLOWER';

    if (prevLogIndex >= 0) {
      const local = this.log[prevLogIndex];
      if (!local || local.term !== prevLogTerm) return false;
    }

    for (let i = 0; i < entries.length; i++) {
      const index = prevLogIndex + 1 + i;
      this.log[index] = entries[i];
    }

    const lastNewEntryIndex = prevLogIndex + entries.length;
    const newCommitIndex = Math.min(leaderCommit, lastNewEntryIndex);

    if (newCommitIndex > this.commitIndex) {
      this.commitIndex = newCommitIndex;
      this.logger.log(`Committed log up to index ${this.commitIndex}`);
      while (this.lastApplied < this.commitIndex) {
        this.lastApplied++;
        this.logger.log(`Applying log at index ${this.lastApplied}`);

        this.applyLogEntry(this.log[this.lastApplied]);
      }
    }

    return true;
  }

  private async requestVotes() {
    let grantedVotes = 1;
    const peersArray = [...this.peers];
    const totalPeers = peersArray.length;

    const lastLogIndex = this.log.length - 1;
    const lastLogTerm = lastLogIndex >= 0 ? this.log[lastLogIndex].term : 0;

    await Promise.all(
      peersArray.map(async (peer) => {
        try {
          const res = await axios.post(
            `http://${peer}/rpc`,
            {
              jsonrpc: '2.0',
              method: 'requestVote',
              params: [
                {
                  term: this.term,
                  candidateId: this.id,
                  candidateAddress: this.selfAddress,
                  lastLogIndex: lastLogIndex,
                  lastLogTerm: lastLogTerm
                }
              ],
              id: 1
            },
            // { timeout: 200 }
          );
          if (res.data.result?.voteGranted) grantedVotes++;
        } catch {
          this.logger.log(`Failed to request vote from ${peer}`);
        }
      })
    );

    this.logger.log(`Vote granted: ${grantedVotes}/${totalPeers + 1}`);
    const majority = Math.floor((totalPeers + 1) / 2) + 1;
    if (grantedVotes >= majority) {
      this.logger.log(`Achieved majority vote, becoming LEADER`);
      this.electionBackoffMultiplier = 1;
      this.becomeLeader();
    } else {
      this.logger.log(`Election failed (got ${grantedVotes}/${totalPeers + 1}) — retrying`);
      // this.electionBackoffMultiplier *= 2;
      this.role = 'FOLLOWER';
      this.startElectionTimeout();
    }
  }

  public appendKVCommand(command: string) {
    this.log.push({ term: this.term, command });
    if (this.peers.size === 0) {
      this.checkCommit();
    } else {
      this.sendAppendEntriesNow();
    }
  }

  public strlen(key: string): number {
    return this.kvStore.strlen(key);
  }

  public getFromStore(key: string): string | null {
    return this.kvStore.get(key);
  }

  public getKvStore(): KVStore {
    return this.kvStore;
  }

  public getRole(): NodeRole {
    return this.role;
  }

  public getPeerIds(): string[] {
    return [...this.peers];
  }

  public getTerm(): number {
    return this.term;
  }

  public getLeaderId(): string | null {
    return this.leaderId;
  }

  public getLogEntry(): LogEntry[] {
    return this.log;
  }

  public getFailedPeerCounts(): Record<string, number> {
    return Object.fromEntries(this.failedPeerCounts);
  }

  public getLeaderAddress(): string | null {
    return this.leaderAddress;
  }

  public getSelfAddress(): string {
    return this.selfAddress;
  }
}
