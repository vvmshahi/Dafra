export type ComplianceProfileStatus = 'missing'|'draft'|'needs_review'|'verified'|'rejected'|'revalidation_required'
export type ComplianceIdentityMode = 'legacy'|'protected'
export interface BranchComplianceProfile { branchId:string; registeredSellerName:string|null; registeredSellerNameAr:string|null; vatNumber:string|null; registrationScheme:string; registrationIdentifier:string|null; buildingNumber:string|null; street:string|null; district:string|null; city:string|null; postalCode:string|null; country:string; status:ComplianceProfileStatus; evidenceReference:string|null; verifiedAt:string|null; verifiedBy:string|null; updatedAt:string }
export interface ComplianceReadiness { available:boolean; branchId:string; mode:ComplianceIdentityMode; status:ComplianceProfileStatus; profile:BranchComplianceProfile|null }
export interface ComplianceAuditItem { id:string; action:string; actor_user_id:string|null; actor_role:string|null; metadata:Record<string,unknown>; created_at:string }
export interface DraftProfilePayload { registeredSellerName:string; registeredSellerNameAr:string; vatNumber:string; registrationScheme:string; registrationIdentifier:string; buildingNumber:string; street:string; district:string; city:string; postalCode:string; country:string; evidenceReference:string }
export interface ReviewTransitionPayload { branchId:string; decision:'verify'|'reject'; reason:string; confirmation:boolean }
export interface ActivationPayload { branchId:string; reason:string }
export interface OfficialSellerConfirmationPayload { branchId:string; payload:DraftProfilePayload; reason:string; confirmation:boolean }
export interface RecoveryPayload { branchId:string; reason:string; confirmation:boolean }
