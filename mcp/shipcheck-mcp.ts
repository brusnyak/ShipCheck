import readline from 'node:readline';

const BASE_URL = (process.env.SHIPCHECK_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let reqId: string | number | null = null;
  try {
    const parsed = JSON.parse(trimmed);
    reqId = parsed.id ?? null;

    const response = await fetch(`${BASE_URL}/api/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: trimmed,
    });

    if (response.status === 204) {
      return;
    }

    const text = await response.text();
    if (text) {
      process.stdout.write(`${text}\n`);
    }
  } catch (err) {
    const errorPayload = {
      jsonrpc: '2.0',
      id: reqId,
      error: {
        code: -32000,
        message: err instanceof Error ? err.message : 'ShipCheck MCP bridge error',
      },
    };
    process.stdout.write(`${JSON.stringify(errorPayload)}\n`);
  }
});
