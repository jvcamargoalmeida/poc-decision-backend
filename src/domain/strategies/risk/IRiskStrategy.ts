import { RiskLevel } from "@/domain/enums/RiskLevel";

interface IRiskStrategy {
    calculateRisk(amount: number): RiskLevel;
}

export { IRiskStrategy };
