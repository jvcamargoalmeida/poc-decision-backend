import { describe, expect, it } from 'vitest';
import { RiskLevel } from '@/domain/enums/RiskLevel';
import { AmountRiskStrategy } from '@/domain/strategies/risk/AmountRiskStrategy';

describe('AmountRiskStrategy', () => {
  const strategy = new AmountRiskStrategy();

  it('classifies amounts above 10000 as HIGH risk', () => {
    expect(strategy.calculateRisk(10001)).toBe(RiskLevel.HIGH);
    expect(strategy.calculateRisk(15000)).toBe(RiskLevel.HIGH);
  });

  it('classifies amounts above 5000 and up to 10000 as MEDIUM risk', () => {
    expect(strategy.calculateRisk(10000)).toBe(RiskLevel.MEDIUM);
    expect(strategy.calculateRisk(7500)).toBe(RiskLevel.MEDIUM);
    expect(strategy.calculateRisk(5001)).toBe(RiskLevel.MEDIUM);
  });

  it('classifies amounts of 5000 or below as LOW risk', () => {
    expect(strategy.calculateRisk(5000)).toBe(RiskLevel.LOW);
    expect(strategy.calculateRisk(0)).toBe(RiskLevel.LOW);
    expect(strategy.calculateRisk(-100)).toBe(RiskLevel.LOW);
  });
});
