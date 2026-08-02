import { RiskLevel } from "../enums/RiskLevel";

interface Transaction {
    id: string;
    amount: number;
    currency: string;
    status: string;
    riskScore: RiskLevel;
    createdAt: Date;
}

export { Transaction };