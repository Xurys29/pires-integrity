import {fail} from './primitives.mjs';
// Derived from priceAt in the approved local pilot. Only confirmed price terms are retained.
export const TERMS=Object.freeze({
  currency:'BRL',cycle:'MONTHLY',priceBasis:'per_license',
  introUnitAmountMinor:2990,introPaidCycles:2,regularUnitAmountMinor:5990,
  trialHours:168,trialTrigger:'first_global_admin_approval',trialReset:false,
  state:'draft',financialEffects:false,
  paymentMethods:Object.freeze(['CREDIT_CARD','PIX','BOLETO']),contractRequired:true,
  trialExpiryCreatesCharge:false,paidStart:null,settlementEvent:null,graceDays:null,overdue:null,
  cancellation:null,fullRefund:null,partialRefund:null,chargeback:null,
  rehirePromotion:null,seatChange:null,proration:null,adminOverride:null,
});
export function quote(payerKind,quantity,paidCycles) {
  if(!['CPF','CNPJ'].includes(payerKind)||!Number.isInteger(quantity)||quantity<1||quantity>999
    ||(payerKind==='CPF'&&quantity!==1)||!Number.isSafeInteger(paidCycles)||paidCycles<0)fail('invalid_license_terms');
  const unitAmountMinor=paidCycles<2?2990:5990;
  return {unitAmountMinor,quantity,totalAmountMinor:unitAmountMinor*quantity,currency:'BRL',chargeCreated:false};
}
export function financialOperation() { fail('financial_operations_not_implemented',409); }
// There is deliberately no environment variable, toggle, API route or default enabling payments.


