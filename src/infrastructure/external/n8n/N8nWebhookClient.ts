import { IDecisionGateway } from '@/domain/services/IDecisionGateway';
import { Transaction } from '@/domain/entities/Transaction';

class N8nWebhookClient implements IDecisionGateway {
  constructor(
    private readonly webhookUrl: string,
    private readonly webhookToken: string,
  ) { }

  async requestDecision(transaction: Transaction): Promise<void> {
    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.webhookToken}`,
      },
      body: JSON.stringify(transaction),
    });

    if (!response.ok) {
      throw new Error(`n8n respondeu ${response.status}`);
    }
  }
}

export { N8nWebhookClient };
