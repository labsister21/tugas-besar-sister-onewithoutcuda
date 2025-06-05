import axios, { AxiosError } from 'axios';

const LEADER_API_BASE_URL = 'http://node3:8083';
const NODE_TO_REMOVE_ADDRESS = 'node5:8085';
const NODE_TO_ADD_ADDRESS = 'node6:8086';

const HTTP_REQUEST_TIMEOUT = 7000;

function logWithTimestamp(message: string, ...optionalParams: any[]) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`, ...optionalParams);
}

function errorWithTimestamp(message: string, ...optionalParams: any[]) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ${message}`, ...optionalParams);
}

interface Command {
  command: string;
  key?: string;
  value?: string;
}

interface ClusterActionPayload {
  address: string;
}

async function sendApiCommand(
  actionName: string,
  apiUrl: string,
  payload: Command | ClusterActionPayload
): Promise<any> {
  logWithTimestamp(`[${actionName}] Mengirim ke ${apiUrl}:`, payload);
  try {
    const response = await axios.post(apiUrl, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: HTTP_REQUEST_TIMEOUT
    });
    logWithTimestamp(
      `[${actionName}] Respons dari ${apiUrl}: Status ${response.status}, Data:`,
      response.data
    );
    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError<any>;
    if (axiosError.isAxiosError) {
      errorWithTimestamp(
        `[${actionName}] Error API ke ${apiUrl}: Status ${axiosError.response?.status}, Data:`,
        axiosError.response?.data || axiosError.message
      );
      if (axiosError.response?.status === 403 && axiosError.response?.data?.address) {
        console.warn(
          `[${new Date().toISOString()}] [${actionName}] Target ${apiUrl} bukan leader. Petunjuk leader: ${axiosError.response.data.address}. Pertimbangkan untuk mengupdate LEADER_API_BASE_URL jika ini adalah target leader.`
        );
      }
    } else {
      errorWithTimestamp(`[${actionName}] Error tidak diketahui ke ${apiUrl}:`, error);
    }

    return { success: false, error: (error as Error).message };
  }
}

async function executeClientCommands(): Promise<void> {
  logWithTimestamp('--- [KLIEN] Memulai urutan perintah set ---');

  await sendApiCommand('KLIEN-SET-1', `${LEADER_API_BASE_URL}/execute`, {
    command: 'set',
    key: 'crocodilo',
    value: 'bombardino'
  });
  await sendApiCommand('KLIEN-SET-2', `${LEADER_API_BASE_URL}/execute`, {
    command: 'set',
    key: 'tung-tung-tung',
    value: 'sahur'
  });
  logWithTimestamp('--- [KLIEN] Urutan perintah set selesai ---');
}

async function executeClusterChanges(): Promise<void> {
  logWithTimestamp('--- [CLUSTER] Memulai perubahan anggota cluster ---');

  await sendApiCommand('CLUSTER-REMOVE', `${LEADER_API_BASE_URL}/remove-member`, {
    address: NODE_TO_REMOVE_ADDRESS
  });

  await new Promise((resolve) => setTimeout(resolve, 10000));
  await sendApiCommand('CLUSTER-ADD', `${LEADER_API_BASE_URL}/join-cluster`, {
    address: NODE_TO_ADD_ADDRESS
  });
  logWithTimestamp('--- [CLUSTER] Perubahan anggota cluster selesai diminta ---');
}

async function runConcurrentActionsTest() {
  logWithTimestamp('Memulai tes aksi konkuren...');

  const results = await Promise.allSettled([executeClusterChanges(), executeClientCommands()]);

  logWithTimestamp('\nSemua aksi yang diminta telah dikirim.');
  results.forEach((result, index) => {
    const actionName = index === 0 ? 'executeClientCommands' : 'executeClusterChanges';
    if (result.status === 'fulfilled') {
      logWithTimestamp(`Aksi ${actionName} selesai dengan sukses (dari perspektif pengiriman).`);
    } else {
      errorWithTimestamp(`Aksi ${actionName} gagal (dari perspektif pengiriman):`, result.reason);
    }
  });

  logWithTimestamp('\nMenunggu beberapa detik untuk stabilisasi cluster potensial...');
  await new Promise((resolve) => setTimeout(resolve, 5000));

  logWithTimestamp('\n--- Verifikasi Data dan Status Cluster (setelah semua selesai) ---');
  try {
    await sendApiCommand('VERIFIKASI-GET-1', `${LEADER_API_BASE_URL}/execute`, {
      command: 'get',
      key: 'crocodilo'
    });
    await sendApiCommand('VERIFIKASI-GET-2', `${LEADER_API_BASE_URL}/execute`, {
      command: 'get',
      key: 'tung-tung-tung'
    });
  } catch (e) {
    errorWithTimestamp('Gagal melakukan verifikasi akhir.');
  }
  logWithTimestamp('Tes aksi konkuren selesai.');
}

runConcurrentActionsTest();
