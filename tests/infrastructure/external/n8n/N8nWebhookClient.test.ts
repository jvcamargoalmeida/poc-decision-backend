import { afterEach, describe, expect, it, vi } from 'vitest';
import { N8nWebhookClient } from '@/infrastructure/external/n8n/N8nWebhookClient';
import { TransactionStatus } from '@/domain/enums/TransactionStatus';
import { RiskLevel } from '@/domain/enums/RiskLevel';
import type { Transaction } from '@/domain/entities/Transaction';

const sampleTransaction: Transaction = {
  id: 'tx-id',
  amount: 5000,
  currency: 'BRL',
  status: TransactionStatus.PENDING,
  riskScore: RiskLevel.MEDIUM,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('N8nWebhookClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('envia a transação via POST em JSON para a URL do webhook', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const client = new N8nWebhookClient('http://localhost:5678/webhook/decision');
    await client.requestDecision(sampleTransaction);

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:5678/webhook/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sampleTransaction),
    });
  });

  it('lança erro quando o n8n responde com status de erro', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal('fetch', fetchMock);

    const client = new N8nWebhookClient('http://localhost:5678/webhook/decision');

    await expect(client.requestDecision(sampleTransaction)).rejects.toThrow('n8n respondeu 500');
  });

  it('propaga o erro quando a chamada HTTP falha (ex.: rede indisponível)', async () => {
    const networkError = new Error('fetch failed');
    const fetchMock = vi.fn().mockRejectedValue(networkError);
    vi.stubGlobal('fetch', fetchMock);

    const client = new N8nWebhookClient('http://localhost:5678/webhook/decision');

    await expect(client.requestDecision(sampleTransaction)).rejects.toThrow(networkError);
  });
});
