export type NodeRole = 'FOLLOWER' | 'CANDIDATE' | 'LEADER';

export interface LogEntry {
  term: number;
  command: string;
}
