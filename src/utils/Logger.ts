export class Logger {
  constructor(private nodeId: string) { }

  log(message: string) {
    const iso = new Date().toISOString();
    const timestamp = iso
      .replace('T', ' ')
      .replace(/\.\d+Z$/, '');
    console.log(`[${timestamp}][${this.nodeId}] ${message}`);
  }

}
