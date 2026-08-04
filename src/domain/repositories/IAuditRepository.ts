interface IAuditRepository {
  logTransaction(transactionId: string, payload: unknown): Promise<void>;
}

export { IAuditRepository };
