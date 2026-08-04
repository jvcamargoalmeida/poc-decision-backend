import type oracledb from 'oracledb';
import type { Connection } from 'mongoose';
import { OracleTransactionRepository } from '@/infrastructure/database/oracle/OracleTransactionRepository';
import { AmountRiskStrategy } from '@/domain/strategies/risk/AmountRiskStrategy';
import { ProcessTransactionUseCase } from '@/application/use-cases/ProcessTransactionUseCase';
import { TransactionController } from '@/presentation/controllers/TransactionController';
import { RabbitMQPublisher } from '@/infrastructure/messaging/rabbitmq/RabbitMQPublisher';
import { type Channel } from 'amqplib';
import { MongoAuditRepository } from '@/infrastructure/database/mongo/MongoAuditRepository';
import { AuditLogDocument, auditLogSchema } from '@/infrastructure/database/mongo/AuditLog.model';
import { UpdateTransactionStatusUseCase } from '@/application/use-cases/UpdateTransactionStatusUseCase';
import { CallbackController } from '@/presentation/controllers/CallbackController';

function buildTransactionController(pool: oracledb.Pool, channel: Channel, mongoClient: Connection): TransactionController {
  const transactionRepository = new OracleTransactionRepository(pool);
  const riskStrategy = new AmountRiskStrategy();
  const mqPublisher = new RabbitMQPublisher(channel);
  const auditLogModel = mongoClient.model<AuditLogDocument>('AuditLog', auditLogSchema);
  const auditRepository = new MongoAuditRepository(auditLogModel);
  const processTransactionUseCase = new ProcessTransactionUseCase(transactionRepository, riskStrategy, mqPublisher, auditRepository);

  return new TransactionController(processTransactionUseCase);
}

function buildCallbackController(pool: oracledb.Pool): CallbackController {
  const transactionRepository = new OracleTransactionRepository(pool);
  const updateTransactionStatusUseCase = new UpdateTransactionStatusUseCase(transactionRepository);

  return new CallbackController(updateTransactionStatusUseCase);
}

export { buildTransactionController, buildCallbackController };
