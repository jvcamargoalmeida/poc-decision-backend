import { describe, expect, it, vi } from 'vitest';
import type { Model } from 'mongoose';
import { MongoAuditRepository } from '@/infrastructure/database/mongo/MongoAuditRepository';
import type { AuditLogDocument } from '@/infrastructure/database/mongo/AuditLog.model';

function createFakeModel() {
  const saveMock = vi.fn().mockResolvedValue(undefined);
  const FakeModel = vi.fn().mockImplementation(function (this: Record<string, unknown>, doc: unknown) {
    Object.assign(this, doc as object);
    this.save = saveMock;
  });
  return { FakeModel: FakeModel as unknown as Model<AuditLogDocument>, saveMock };
}

describe('MongoAuditRepository', () => {
  it('cria o documento com o model injetado e salva no Mongo', async () => {
    const { FakeModel, saveMock } = createFakeModel();
    const repository = new MongoAuditRepository(FakeModel);

    await repository.logTransaction('tx-id', { amount: 100 });

    expect(FakeModel).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: 'tx-id', payload: { amount: 100 } }),
    );
    expect(saveMock).toHaveBeenCalledTimes(1);
  });

  it('propaga o erro quando o save do documento falha', async () => {
    const { FakeModel, saveMock } = createFakeModel();
    const saveError = new Error('falha ao gravar no Mongo');
    saveMock.mockRejectedValue(saveError);
    const repository = new MongoAuditRepository(FakeModel);

    await expect(repository.logTransaction('tx-id', { amount: 100 })).rejects.toThrow(saveError);
  });
});
