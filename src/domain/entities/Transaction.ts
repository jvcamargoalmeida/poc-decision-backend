import { RiskLevel } from "../enums/RiskLevel";
import { TransactionStatus } from "../enums/TransactionStatus";

interface Transaction {
    id?: string;
    amount: number;
    currency: string;
    status: TransactionStatus;
    riskScore: RiskLevel;
    /** Chave enviada pelo cliente para tornar o retry seguro. Opcional. */
    idempotencyKey?: string;
    createdAt: Date;
}

export { Transaction };