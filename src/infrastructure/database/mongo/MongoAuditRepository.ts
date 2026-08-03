import { IAuditRepository } from '@/domain/repositories/IAuditRepository';
import { AuditLogDocument} from './AuditLog.model';
import { Model } from 'mongoose';

class MongoAuditRepository implements IAuditRepository {
  constructor(private readonly auditLogModel: Model<AuditLogDocument>) {}

  async logTransaction(transactionId: string, payload: unknown): Promise<void> {
    const auditLog = new this.auditLogModel({
      transactionId,
      payload,
      createdAt: new Date(),
    });

    await auditLog.save();
  }
}
export { MongoAuditRepository };
