import axios, { AxiosError } from 'axios';

const LEADER_API_URL = 'http://node1:8081/execute';

interface Command {
  command: string;
  key?: string;
  value?: string;
}

function logWithTimestamp(message: string, ...optionalParams: any[]) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, ...optionalParams);
}

function errorWithTimestamp(message: string, ...optionalParams: any[]) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ${message}`, ...optionalParams);
}

async function sendApiCommand(clientName: string, payload: Command): Promise<any> {
  logWithTimestamp(
    `[${clientName}] Mengirim: command='${payload.command}', key='${payload.key || ''}', value='${payload.value || ''}'`
  );
  try {
    const response = await axios.post(LEADER_API_URL, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 7000
    });
    logWithTimestamp(
      `[${clientName}] Respons untuk ${payload.command} ${payload.key || ''}:`,
      response.data
    );
    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError<any>;
    if (axiosError.isAxiosError) {
      errorWithTimestamp(
        `[${clientName}] Error API untuk ${payload.command} ${payload.key || ''}: Status ${axiosError.response?.status}, Data:`,
        axiosError.response?.data || axiosError.message
      );
      if (axiosError.response?.status === 403 && axiosError.response?.data?.address) {
        console.warn(
          `[${new Date().toISOString()}] [${clientName}] Target bukan leader. Petunjuk leader: ${axiosError.response.data.address}. Harap perbarui LEADER_API_URL.`
        );
      }
    } else {
      errorWithTimestamp(
        `[${clientName}] Error tidak diketahui untuk ${payload.command} ${payload.key || ''}:`,
        error
      );
    }
    throw error;
  }
}

async function executeClientSequence(clientName: string, commands: Command[]): Promise<void> {
  logWithTimestamp(`--- [${clientName}] Memulai urutan perintah ---`);
  for (const cmd of commands) {
    await sendApiCommand(clientName, cmd);
  }
  logWithTimestamp(`--- [${clientName}] Urutan perintah selesai ---`);
}

async function runParallelClientTests() {
  const client1Sequence: Command[] = [
    { command: 'set', key: 'ruby-chan', value: 'choco-minto' },
    { command: 'append', key: 'ruby-chan', value: '-yori-mo-anata' }
  ];

  const client2Sequence: Command[] = [
    { command: 'set', key: 'ayumu-chan', value: 'strawberry-flavor' },
    { command: 'append', key: 'ayumu-chan', value: '-yori-mo-anata' }
  ];

  try {
    await Promise.all([
      executeClientSequence('NodeKlien1', client1Sequence),
      executeClientSequence('NodeKlien2', client2Sequence)
    ]);

    logWithTimestamp('\nSemua grup perintah paralel telah selesai dieksekusi.');

    logWithTimestamp('\n--- Verifikasi Data (setelah semua selesai) ---');
    await sendApiCommand('Verifikasi', { command: 'get', key: 'ruby-chan' });
    await sendApiCommand('Verifikasi', { command: 'get', key: 'ayumu-chan' });
  } catch (e) {
    errorWithTimestamp('\nSalah satu atau lebih urutan klien gagal dieksekusi.');
  }
}

runParallelClientTests();
