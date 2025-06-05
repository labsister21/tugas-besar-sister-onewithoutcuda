import axios from 'axios';

export class RaftClient {
  private currentLeaderAddress: string | null = null;
  private currentLeaderId: string | null = null;
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

  private async sendAdminCommand(path: string, body: { address: string }, successMsg: string) {
    const node = this.currentLeaderAddress
      ? this.currentLeaderAddress
      : this.nodes[Math.floor(Math.random() * this.nodes.length)];

    try {
      const res = await axios.post(`http://${node}${path}`, body);
      if (res.data.success) {
        if (node === this.currentLeaderAddress && path === '/remove-member') {
          this.currentLeaderAddress = null;
          this.currentLeaderId = null;
          this.nodes = this.nodes.filter((n) => n !== body.address);
          this.currentLeaderAddress = this.nodes.length > 0 ? this.nodes[0] : null;
          console.log(this.currentLeaderAddress);
          console.log('Updated nodes: ', this.nodes.join(', '));
          console.log('→', successMsg);
        } else {
          this.currentLeaderAddress = node;
          await this.refreshPeers();
          console.log('→', successMsg);
        }

        return;
      }
    } catch (err: any) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const leaderHintId = err.response?.data?.leader;
        const leaderHint = err.response?.data?.address;

        if (status === 403 && leaderHint && leaderHintId) {
          console.log(`Redirecting to leader ${leaderHintId} at ${leaderHint} for ${path}`);
          this.currentLeaderAddress = leaderHint;
          this.currentLeaderId = leaderHintId;
          await this.sendAdminCommand(path, body, successMsg);
          return;
        }

        console.log(`Admin command to ${node}${path} failed with status ${status}`);
      } else {
        console.log('Unexpected error:', err);
      }
    }

    console.log('Failed: No reachable leader or action rejected');
  }

  private async refreshPeers() {
    if (!this.currentLeaderAddress) return;
    try {
      const res = await axios.get(`http://${this.currentLeaderAddress}/status`);
      const peers: string[] = res.data.peers || [];
      const self: string = res.data.selfAddress;
      this.nodes = [self, ...peers];
      this.currentLeaderId = res.data.leader;
      this.currentLeaderAddress = res.data.leaderAddress;
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

  async getLog() {
    if (!this.currentLeaderAddress) {
      console.log('Failed: No reachable leader');
      return;
    }

    const address = this.currentLeaderAddress;
    if (!this.nodes.includes(address)) {
      console.log(`Address ${address} is not in known nodes list`);
      return;
    }

    try {
      const res = await axios.get(`http://${address}/request_log`);
      const logs = res.data.logs || [];

      for (let i = 0; i < logs.length; i++) {
        console.log(`${i + 1}. Term: ${logs[i].term} - Command: ${logs[i].command}`);
      }
    } catch (err: any) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const leaderHintId = err.response?.data?.leader;
        const leaderHint = err.response?.data?.address;

        if (status === 403 && leaderHint && leaderHintId) {
          console.log(`Redirecting to leader ${leaderHintId} at ${leaderHint}`);
          this.currentLeaderAddress = leaderHint;
          this.currentLeaderId = leaderHintId;
          await this.getLog();
          return;
        }

        console.log(`Get log failed with status ${status}`);
      } else {
        console.log('Unexpected error:', err);
      }
    }
  }

  async ping() {
    const address = this.currentLeaderAddress;
    if (!address) {
      console.log('No current leader to ping');
      return;
    }
    try {
      const res = await axios.get(`http://${address}/ping`);
      console.log(`Ping to ${address}:`, res.data);
    } catch (err: any) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const leaderHintId = err.response?.data?.leader;
        const leaderHint = err.response?.data?.address;

        if (status === 403 && leaderHint && leaderHintId) {
          console.log(`Redirecting to leader ${leaderHintId} at ${leaderHint}`);
          this.currentLeaderAddress = leaderHint;
          this.currentLeaderId = leaderHintId;
          await this.ping();
          return;
        }

        console.log(`Ping failed with status ${status}`);
      } else {
        console.log('Unexpected error:', err);
      }
    }
  }

  async refreshStatus() {
    if (!this.currentLeaderAddress) {
      console.log('No current leader to show client data');
      return;
    }
    try {
      const res = await axios.get(`http://${this.currentLeaderAddress}/status`);
      const peers: string[] = res.data.peers || [];
      const self: string = res.data.selfAddress;
      const leader = res.data.leader || '';
      const leaderAddress = res.data.leaderAddress || '';

      this.nodes = [self, ...peers];
      this.currentLeaderAddress = leaderAddress;
      this.currentLeaderId = leader;
      console.log('Updated client data');
    } catch {
      console.log(`Failed to refresh client data`);
    }
  }

  async showClientData() {
    console.log('Current leader id:', this.currentLeaderId);
    console.log('Current leader address:', this.currentLeaderAddress);
    console.log('Known nodes:', this.nodes.join(', '));
  }

  async setLeaderAddress(address: string) {
    this.currentLeaderAddress = address;
    this.currentLeaderId = null;
    console.log(`Leader address set to: ${address}`);
  }

  async initializeFromSeedNode(address: string) {
    try {
      const res = await axios.get(`http://${address}/status`);
      const peers: string[] = res.data.peers || [];
      const self: string = res.data.selfAddress;
      const leader = res.data.leader || '';
      const leaderAddress = res.data.leaderAddress || '';

      this.nodes = [self, ...peers];
      this.currentLeaderAddress = leaderAddress;
      this.currentLeaderId = leader;
      console.log('Connected to cluster via:', address);
      await this.showClientData();
    } catch {
      console.log(`Failed to contact seed node at ${address}`);
      process.exit(1);
    }
  }

  async setHeartbeat(visibility: boolean) {
    for (const node of this.nodes) {
      try {
        const res = await axios.post(`http://${node}/toggle-heartbeat`, { visibility });
        if (res.status === 200) {
          console.log(`Heartbeat visibility set to ${visibility} on ${node}`);
        }
      } catch (error: any) {
        console.log(`Failed to set heartbeat visibility on ${node}:`, error.message);
      }
    }
  }

  async sendCommand(command: string, key?: string, value?: string): Promise<void> {
    if (value === undefined) value = '';
    const payload = { command, key, value };

    if (!this.currentLeaderAddress) {
      const random = this.nodes[Math.floor(Math.random() * this.nodes.length)];
      try {
        const res = await axios.post(`http://${random}/execute`, payload);
        if (res.data.result !== undefined) {
          this.currentLeaderAddress = random;
          console.log('→', res.data.result);
          return;
        }
      } catch (err: any) {
        if (axios.isAxiosError(err)) {
          const status = err.response?.status;
          const leaderHintId = err.response?.data?.leader;
          const leaderHint = err.response?.data?.address;

          if (status === 403 && leaderHint && leaderHintId) {
            console.log(
              `Initial request to ${random} rejected. Redirecting to leader ${leaderHintId} at ${leaderHint}`
            );
            this.currentLeaderAddress = leaderHint;
            this.currentLeaderId = leaderHintId;
            await this.sendCommand(command, key, value);
            return;
          }

          console.log(`Request to ${random} failed with status ${status}`);
        } else {
          console.log('Unexpected error on request to', random, ':', err);
        }
      }
    }

    if (this.currentLeaderAddress) {
      try {
        const res = await axios.post(`http://${this.currentLeaderAddress}/execute`, payload);
        if (res.data.result !== undefined) {
          const value = res.data.result ?? ''
          console.log('→', value)
          return;
        }
      } catch (err: any) {
        if (axios.isAxiosError(err)) {
          const status = err.response?.status;
          const leaderHintId = err.response?.data?.leader;
          const leaderHint = err.response?.data?.address;

          if (status === 403 && leaderHint && leaderHintId) {
            console.log(
              `Request to ${this.currentLeaderAddress} rejected. Redirecting to leader ${leaderHintId} at ${leaderHint}`
            );
            this.currentLeaderAddress = leaderHint;
            this.currentLeaderId = leaderHintId;
            await this.sendCommand(command, key, value);
            return;
          }

          console.log(`Request to ${this.currentLeaderAddress} failed with status ${status}`);
        } else {
          console.log('Unexpected error on request to', this.currentLeaderAddress, ':', err);
        }
      }
    }

    console.log('Failed to execute command (no reachable leader)');
  }
}
