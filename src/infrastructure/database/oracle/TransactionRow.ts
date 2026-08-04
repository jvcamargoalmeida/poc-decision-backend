import { RiskLevel } from "@/domain/enums/RiskLevel";
import { TransactionStatus } from "@/domain/enums/TransactionStatus";

/**
 * Formato bruto de uma linha retornada pelo driver oracledb (outFormat: OUT_FORMAT_OBJECT)
 * para a tabela `transactions`. Nomes de coluna em maiúsculo, sem nenhum mapeamento aplicado
 * ainda — a conversão para `Transaction` (camelCase, enums, etc.) é feita manualmente em
 * `OracleTransactionRepository`.
 */
interface TransactionRowLists {
  ID: string;
  AMOUNT: number;
  CURRENCY: string;
  STATUS: TransactionStatus;
  RISK_SCORE: RiskLevel;
  IDEMPOTENCY_KEY: string | null;
  CREATED_AT: Date;
}


export { TransactionRowLists };
