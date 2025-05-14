import axios from 'axios';
import { KVStore } from '../kvstore/KVStore';
import { Logger } from '../utils/Logger';
import { LogEntry, NodeRole } from '../types/raft';

export class RaftNode {
  private role: NodeRole = 'FOLLOWER';
  private term = 0;
  private votedFor: string | null = null;
  private log: LogEntry[] = [];
  private commitIndex = -1;
  private leaderId: string | null = null;
  private leaderAddress: string | null = null;

  private electionTimeout?: NodeJS.Timeout;
  private heartbeatInterval?: NodeJS.Timeout;
  private peers: Set<string> = new Set();

  private failedPeerCounts: Map<string, number> = new Map();
  private readonly MAX_FAILED_HEARTBEATS = 10;

  private nextIndex: Map<string, number> = new Map();
  private matchIndex: Map<string, number> = new Map();

  constructor(
    private readonly id: string,
    private readonly kvStore: KVStore,
    initialPeers: string[],
    private readonly logger: Logger,
    private readonly selfAddress: string
  ) {
    this.peers = new Set(initialPeers);
    this.startElectionTimeout();
  }

  private startElectionTimeout() {
    this.clearTimeouts();
    const timeout = 150 + Math.random() * 150;
    this.electionTimeout = setTimeout(() => {
      this.logger.log(`[${this.id}] Election timeout — assuming leader is dead`);
      this.startElection();
    }, timeout);
  }

  private startElection() {
    this.role = 'CANDIDATE';
    this.term += 1;
    this.votedFor = this.id;
    this.logger.log(`[${this.id}] Starting election for term ${this.term}`);
    this.requestVotes();
  }

  public receiveVoteRequest(term: number, candidateId: string): boolean {
    if (term < this.term) return false;

    if (term > this.term) {
      this.term = term;
      this.votedFor = null;
      this.role = 'FOLLOWER';
    }

    if (this.votedFor === null || this.votedFor === candidateId) {
      this.votedFor = candidateId;
      this.startElectionTimeout();
      this.logger.log(`[${this.id}] Voted for ${candidateId} in term ${term}`);
      return true;
    }

    return false;
  }

  private becomeLeader() {
    this.role = 'LEADER';
    this.logger.log(`[${this.id}] Became LEADER for term ${this.term}`);

    for (const peer of this.peers) {
      this.nextIndex.set(peer, this.log.length);
      this.matchIndex.set(peer, -1);
    }

    this.startHeartbeat();
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
          this.logger.log(`[${this.id}] Sending ${entries.length} log entries to ${peer}`);
        }

        axios
          .post(`http://${peer}/rpc/append-entries`, {
            term: this.term,
            leaderId: this.id,
            leaderAddress: this.selfAddress,
            prevLogIndex,
            prevLogTerm,
            entries,
            leaderCommit: this.commitIndex
          })
          .then((res) => {
            if (res.data.success) {
              this.failedPeerCounts.set(peer, 0);
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
              this.logger.log(
                `[${this.id}] Peer ${peer} is likely down (missed ${fails} heartbeats)`
              );
            }
          });
      }
    }, 100);
  }

  private clearTimeouts() {
    if (this.electionTimeout) clearTimeout(this.electionTimeout);
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
  }

  private applyLogEntry(entry: LogEntry) {
    const [cmd, ...args] = entry.command.split(':');
    const peer = args.join(':');

    if (cmd === 'addMember') {
      if (peer !== this.selfAddress && !this.peers.has(peer)) {
        this.peers.add(peer);
        this.logger.log(`[${this.id}] Applied log: addMember ${peer}`);
      }
    }

    if (cmd === 'removeMember') {
      if (this.peers.delete(peer)) {
        this.nextIndex.delete(peer);
        this.matchIndex.delete(peer);
        this.failedPeerCounts.delete(peer);
        this.logger.log(`[${this.id}] Applied log: removeMember ${peer}`);
      }
    }

    if (cmd === 'set') {
      const [k, v] = args.join(':').split(':');
      this.kvStore.set(k, v);
      this.logger.log(`[${this.id}] Applied log: set ${k} = ${v}`);
    }

    if (cmd === 'del') {
      const key = args.join(':');
      this.kvStore.del(key);
      this.logger.log(`[${this.id}] Applied log: del ${key}`);
    }

    if (cmd === 'append') {
      const [k, v] = args.join(':').split(':');
      this.kvStore.append(k, v);
      this.logger.log(`[${this.id}] Applied log: append ${k} += ${v}`);
    }

    //
  }

  private checkCommit() {
    const match = [...this.matchIndex.values()];
    match.push(this.log.length - 1);
    match.sort((a, b) => b - a);

    const N = match[Math.floor(match.length / 2)];
    if (N > this.commitIndex && this.log[N]?.term === this.term) {
      this.commitIndex = N;
      this.logger.log(`[${this.id}] Log committed up to index ${N}`);
      for (let i = 0; i <= this.commitIndex; i++) {
        this.applyLogEntry(this.log[i]);
      }
    }
  }

  public addPeer(address: string, isNewJoin = false) {
    if (!this.peers.has(address)) {
      this.peers.add(address);
      this.nextIndex.set(address, isNewJoin ? 0 : this.log.length);
      this.matchIndex.set(address, -1);
      this.logger.log(`[${this.id}] Peer manually added: ${address}`);
    }
  }

  public forceBootstrapSelf() {
    this.log.push({ term: this.term, command: `addMember:${this.selfAddress}` });
    this.commitIndex = this.log.length - 1;
    this.logger.log(
      `[${this.id}] Bootstrapping self as single-node cluster at ${this.selfAddress}`
    );

    for (let i = 0; i <= this.commitIndex; i++) {
      this.applyLogEntry(this.log[i]);
    }
  }

  public appendAddMemberLog(address: string) {
    this.log.push({ term: this.term, command: `addMember:${address}` });

    if (!this.peers.has(address)) {
      this.peers.add(address);
      this.nextIndex.set(address, this.log.length);
      this.matchIndex.set(address, -1);
    }

    this.sendAppendEntriesNow();
  }

  private sendAppendEntriesNow() {
    for (const peer of this.peers) {
      const next = this.nextIndex.get(peer) ?? this.log.length;
      const prevLogIndex = next - 1;
      const prevLogTerm = this.log[prevLogIndex]?.term ?? 0;
      const entries = this.log.slice(next);

      axios
        .post(`http://${peer}/rpc/append-entries`, {
          term: this.term,
          leaderId: this.id,
          leaderAddress: this.selfAddress,
          prevLogIndex,
          prevLogTerm,
          entries
        })
        .then((res) => {
          if (res.data.success) {
            this.failedPeerCounts.set(peer, 0);
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
            this.logger.log(
              `[${this.id}] Peer ${peer} is likely down (missed ${fails} heartbeats)`
            );
          }
        });
    }
  }

  public appendRemoveMemberLog(address: string) {
    this.log.push({ term: this.term, command: `removeMember:${address}` });

    this.logger.log(
      `[${this.id}] Queued removeMember:${address} → log length now ${this.log.length}`
    );

    this.sendAppendEntriesNow();
  }

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

    this.term = term;
    this.leaderId = leaderId;
    this.leaderAddress = leaderAddress;
    this.role = 'FOLLOWER';
    this.startElectionTimeout();

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
      this.logger.log(`[${this.id}] Committed log up to index ${this.commitIndex}`);
      for (let i = 0; i <= this.commitIndex; i++) {
        this.applyLogEntry(this.log[i]);
      }
    }

    return true;
  }

  private async requestVotes() {
    let grantedVotes = 1;
    const peersArray = [...this.peers];
    const totalPeers = peersArray.length;

    await Promise.all(
      peersArray.map(async (peer) => {
        try {
          const res = await axios.post(`http://${peer}/rpc/request-vote`, {
            term: this.term,
            candidateId: this.id
          });
          if (res.data.voteGranted) grantedVotes++;
        } catch {
          this.logger.log(`[${this.id}] Failed to request vote from ${peer}`);
        }
      })
    );

    this.logger.log(`[${this.id}] Vote granted: ${grantedVotes}/${totalPeers + 1}`);
    const majority = Math.floor((totalPeers + 1) / 2) + 1;
    if (grantedVotes >= majority) {
      this.logger.log(`[${this.id}] Achieved majority vote, becoming LEADER`);
      this.becomeLeader();
    } else {
      this.logger.log(
        `[${this.id}] Election failed (got ${grantedVotes}/${totalPeers + 1}) — retrying`
      );
      this.role = 'FOLLOWER';
      this.startElectionTimeout();
    }
  }

  public appendKVCommand(command: string) {
    this.log.push({ term: this.term, command });
    this.sendAppendEntriesNow();
  }

  public strlen(key: string): number {
    return this.kvStore.strlen(key);
  }

  public getFromStore(key: string): string {
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
}
