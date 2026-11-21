/** Monthly cost estimate (port of mortgage.py). Always shown as an estimate, never an offer of credit. */

export interface MortgageInput {
  priceAed: number;
  downPct: number;
  ratePct: number;
  years: number;
}
export interface MortgageEstimate {
  priceAed: number;
  downPct: number;
  ratePct: number;
  years: number;
  downAed: number;
  loanAed: number;
  monthlyAed: number;
  upfrontAed: number;
  upfront: { down: number; dldFee: number; mortgageRegistration: number; agencyFee: number; agencyVat: number };
}

/** Dubai buyer costs: 4% DLD transfer fee, 0.25% mortgage registration, 2% agency fee plus 5% VAT. */
export const DLD_FEE = 0.04,
  MORTGAGE_REG = 0.0025,
  AGENCY_FEE = 0.02,
  VAT = 0.05;

/** Expat first home: at least 20% down up to AED 5,000,000, 30% above. */
export const MIN_DOWN_THRESHOLD_AED = 5_000_000;

export function minDownPct(priceAed: number): 20 | 30 {
  return priceAed > MIN_DOWN_THRESHOLD_AED ? 30 : 20;
}

export function estimateMortgage(i: MortgageInput): MortgageEstimate {
  const { priceAed, downPct, ratePct, years } = i;
  const downAed = (priceAed * downPct) / 100;
  const loanAed = priceAed * (1 - downPct / 100);
  const r = ratePct / 100 / 12;
  const n = years * 12;
  const monthlyAed = r > 0 ? (loanAed * r) / (1 - (1 + r) ** -n) : loanAed / n;
  const dldFee = priceAed * DLD_FEE;
  const mortgageRegistration = loanAed * MORTGAGE_REG;
  const agencyFee = priceAed * AGENCY_FEE;
  const agencyVat = agencyFee * VAT;
  const upfrontAed = downAed + dldFee + mortgageRegistration + agencyFee + agencyVat;
  return {
    priceAed,
    downPct,
    ratePct,
    years,
    downAed,
    loanAed,
    monthlyAed,
    upfrontAed,
    upfront: { down: downAed, dldFee, mortgageRegistration, agencyFee, agencyVat },
  };
}
