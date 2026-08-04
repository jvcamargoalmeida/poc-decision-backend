import { Transaction } from '@/domain/entities/Transaction';

interface IDecisionGateway {
  requestDecision(transaction: Transaction): Promise<void>;
}

export { IDecisionGateway };
