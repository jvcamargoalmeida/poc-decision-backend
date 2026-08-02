import { RiskLevel } from "@/domain/enums/RiskLevel";
import { IRiskStrategy } from "./IRiskStrategy";

class AmountRiskStrategy implements IRiskStrategy {

    calculateRisk(amount: number): RiskLevel {
        const rules = [
            { limit: 10000, risk: RiskLevel.HIGH },
            { limit: 5000, risk: RiskLevel.MEDIUM }
        ];
        const matchedRule = rules.find(rule => amount > rule.limit);
        return matchedRule?.risk ?? RiskLevel.LOW;
    };

}

export { AmountRiskStrategy };