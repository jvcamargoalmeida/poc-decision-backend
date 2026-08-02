import { RiskLevel } from "../enums/RiskLevel";
import { TransactionStatus } from "../enums/TransactionStatus";

interface Transaction {
    id?: string;
    amount: number;
    currency: string;
    status: TransactionStatus;
    riskScore: RiskLevel;
    createdAt: Date;
}

export { Transaction };