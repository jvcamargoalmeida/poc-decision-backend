import { IAuditRepository } from '@/domain/repositories/IAuditRepository';
import { AuditLogDocument} from './AuditLog.model';
import { Model } from 'mongoose';

class MongoAuditRepository implements IAuditRepository {
  constructor(private readonly auditLogModel: Model<AuditLogDocument>) {}

  async logTransaction(transactionId: string, payload: unknown, clientId?: string): Promise<void> {
    const auditLog = new this.auditLogModel({
      transactionId,
      payload,
      clientId,
      createdAt: new Date(),
    });

    await auditLog.save();
  }
}
export { MongoAuditRepository };
