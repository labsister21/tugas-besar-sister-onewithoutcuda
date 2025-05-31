import axios from 'axios';

export class RaftClient {
  private currentLeader: string | null = null;
  private nodes: string[] = [];

  async addMember(address: string) {
    await this.sendAdminCommand('/join-cluster', { address }, 'Member added');
  }

  async removeMember(address: string) {
    await this.sendAdminCommand('/remove-member', { address }, 'Member removed');
  }

  async getPeers() {
    for (const node of this.nodes) {
      try {
        const res = await axios.get(`http://${node}/status`);
        console.log(`→ [${node}] Peers:`, res.data.peers);
        return;
      } catch {
        continue;
      }
    }
  }

  private async sendAdminCommand(path: string, body: object, successMsg: string) {
    const targets = this.currentLeader
      ? [this.currentLeader]
      : [this.nodes[Math.floor(Math.random() * this.nodes.length)]];

    for (const node of targets) {
      try {
        const res = await axios.post(`http://${node}${path}`, body);
        if (res.data.success) {
          this.currentLeader = node;
          console.log('→', successMsg);
          await this.refreshPeers();
          return;
        }
      } catch (err: any) {
        const leaderHint = err?.response?.data?.leader;
        if (leaderHint) this.currentLeader = leaderHint;
      }
    }

    console.log('Failed: No reachable leader or action rejected');
  }

  private async refreshPeers() {
    if (!this.currentLeader) return;
    try {
      const res = await axios.get(`http://${this.currentLeader}/status`);
      const peers: string[] = res.data.peers || [];
      const self: string = res.data.selfAddress;
      this.nodes = [self, ...peers];
      console.log('Updated nodes: ', this.nodes.join(', '));
    } catch {
      console.log('Failed to refresh peers from leader');
    }
  }

  async getNodeStatus(address: string) {
    if (!this.nodes.includes(address)) {
      console.log(`Address ${address} is not in known nodes list`);
      return;
    }

    try {
      const res = await axios.get(`http://${address}/status`);
      console.log(`Status from ${address}:`);
      console.log(JSON.stringify(res.data, null, 2));
    } catch {
      console.log(`Failed to fetch status from ${address}`);
    }
  }

  async initializeFromSeedNode(address: string) {
    try {
      const res = await axios.get(`http://${address}/status`);
      const peers: string[] = res.data.peers || [];
      const self: string = res.data.selfAddress;
      const leader: string = res.data.leader !== null ? res.data.leader : address;

      this.nodes = [self, ...peers];
      this.currentLeader = leader;
      console.log('Connected to cluster via:', address);
      console.log('Current leader:', leader);
      console.log('Known nodes:', this.nodes.join(', '));
    } catch {
      console.log(`Failed to contact seed node at ${address}`);
      process.exit(1);
    }
  }

  async sendCommand(command: string, key?: string, value?: string): Promise<void> {
    const payload = { command, key, value };

    if (!this.currentLeader) {
      const random = this.nodes[Math.floor(Math.random() * this.nodes.length)];
      try {
        const res = await axios.post(`http://${random}/execute`, payload);
        if (res.data.result !== undefined) {
          this.currentLeader = random;
          console.log('→', res.data.result);
          return;
        }
      } catch (err: any) {
        const leaderHint = err?.response?.data?.leader;
        if (leaderHint) this.currentLeader = leaderHint;
      }
    }

    if (this.currentLeader) {
      try {
        if (command === 'ping') {
          const res = await axios.get(`http://${this.currentLeader}/ping`)
          if (res.data !== undefined) {
            console.log(`→ ${res.data}`);
            return;
          }
        } else {
          const res = await axios.post(`http://${this.currentLeader}/execute`, payload);
          if (res.data.result !== undefined) {
            console.log(`→ ${res.data.result}`);
            return;
          }
        }
      } catch (err: any) {
        const leaderHint = err?.response?.data?.leader;
        if (leaderHint) this.currentLeader = leaderHint;
      }
    }

    console.log('Failed to execute command (no reachable leader)');
  }
}
