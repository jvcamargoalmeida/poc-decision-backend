interface IAuditRepository {
  /**
   * Registra o payload bruto da transação para fins de auditoria/compliance.
   *
   * @param transactionId ID da transação já persistida
   * @param payload Documento como veio, sem imposição de forma
   * @param clientId Identificador do cliente que originou a requisição. Opcional
   *   porque nem toda origem é um cliente autenticado da API — sem ele a trilha
   *   registra *o que* aconteceu, mas não *quem* pediu.
   */
  logTransaction(transactionId: string, payload: unknown, clientId?: string): Promise<void>;
}

export { IAuditRepository };
