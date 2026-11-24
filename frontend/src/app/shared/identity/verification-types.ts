// ALTEGO necesita definir los contratos de datos de verificación.
// Este módulo declara las estructuras compartidas para intercambiar esos datos con tipos consistentes.
export type VerificationState='not_eligible'|'eligible'|'pending'|'verified'|'rejected'|'revoked';
export type ReviewDecision='approve'|'reject'|'revoke';

export interface VerificationApplication {
  id:number;
  user_id:number;
  status:'pending'|'approved'|'rejected'|'revoked';
  submitted_at:string;
  decided_at:string|null;
  decided_by:number|null;
  rejection_reason:string|null;
  revoked_at:string|null;
  revoked_by:number|null;
  revocation_reason:string|null;
  retry_at:string|null;
}
export interface VerificationStatus {
  permanent?:boolean;approved_exception?:{omitted_requirements:string[];reason?:string}|null;administrative_grants_available?:boolean;
  state:VerificationState;
  canApply:boolean;
  eligible:boolean;
  metrics:{salesCents:number|null;approvedItems:number;completeProfile:boolean;ageDays:number;accountActive:boolean;activeSanctions:number|null};
  profile:{id:number;username:string;display_name:string;bio:string|null;avatar_url:string|null};
  application:VerificationApplication|null;
}
export type VerificationQueue='pending'|'approved'|'rejected'|'verified'|'history';
export type VerificationEntry=VerificationApplication & {username:string;display_name:string};
export interface VerificationReview {
  selected:VerificationApplication;
  history:VerificationApplication[];
  status:VerificationStatus;
}
export interface PublicationReview {review_id:number;product_id:number;name:string;owner_id:number;username:string;submitted_at:string;}
export interface ReviewPage<T> {items:T[];next:number|null;}
export const rejectionReasons=[
  ['eligibility','Eligibility requirements not met'],
  ['original_content','Insufficient evidence of original content'],
  ['suspicious_activity','Suspicious account activity'],
  ['guidelines','Community guideline violations'],
  ['other','Other'],
] as const;
export const revocationReasons=[
  ['guidelines','Community guideline violations'],
  ['fraud','Fraudulent or misleading activity'],
  ['privilege_abuse','Abuse of verified privileges'],
  ['security','Account security concerns'],
  ['other','Other'],
] as const;
export function decisionReason(application:VerificationApplication){
  const reasons=application.status==='revoked'?revocationReasons:rejectionReasons;
  const value=application.status==='revoked'?application.revocation_reason:application.rejection_reason;
  return reasons.find(([key])=>key===value)?.[1] ?? '';
}
