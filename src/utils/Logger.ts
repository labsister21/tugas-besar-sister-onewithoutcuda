export class Logger {
  constructor(private nodeId: string) {}

  log(message: string) {
    console.log(`[${new Date().toISOString()}][${this.nodeId}] ${message}`);
  }
}
