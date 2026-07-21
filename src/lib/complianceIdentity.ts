import { supabase } from '@/lib/supabase'
import type { ActivationPayload, ComplianceAuditItem, ComplianceReadiness, DraftProfilePayload, OfficialSellerConfirmationPayload, RecoveryPayload, ReviewTransitionPayload } from '@/types/complianceIdentity'

function unavailable(error: any) { return error?.code === 'PGRST202' || error?.code === '42883' || /not find.*function|does not exist/i.test(error?.message ?? '') }
async function rpc<T>(name:string,args:Record<string,unknown>={}) { const {data,error}=await (supabase as any).rpc(name,args); if(error) throw error; return data as T }
export async function complianceCapability(){ try{return await rpc<{available:boolean;schema_version:number}>('get_compliance_identity_capability')}catch(e){if(unavailable(e))return{available:false,schema_version:0};throw e} }
export const getComplianceReadiness=(branchId:string)=>rpc<ComplianceReadiness>('get_branch_compliance_readiness',{p_branch_id:branchId})
export const saveComplianceDraft=(branchId:string,payload:DraftProfilePayload,reason:string)=>rpc('save_branch_compliance_draft',{p_branch_id:branchId,p_payload:payload,p_reason:reason})
export const submitComplianceReview=(branchId:string,reason:string)=>rpc('submit_branch_compliance_profile',{p_branch_id:branchId,p_reason:reason})
export const reviewCompliance=(payload:ReviewTransitionPayload)=>rpc('review_branch_compliance_profile',{p_branch_id:payload.branchId,p_decision:payload.decision,p_reason:payload.reason,p_confirmation:payload.confirmation})
export const activateCompliance=(payload:ActivationPayload)=>rpc('activate_branch_compliance_identity',{p_branch_id:payload.branchId,p_reason:payload.reason,p_confirmation:true})
export const confirmOfficialSellerInformation=(input:OfficialSellerConfirmationPayload)=>rpc('confirm_branch_official_seller_information',{p_branch_id:input.branchId,p_payload:input.payload,p_reason:input.reason,p_confirmation:input.confirmation})
export const recoverLegacyMode=(payload:RecoveryPayload)=>rpc('deactivate_protected_identity_mode',{p_branch_id:payload.branchId,p_reason:payload.reason,p_confirmation:payload.confirmation})
export const getComplianceAudit=(branchId:string)=>rpc<ComplianceAuditItem[]>('get_branch_compliance_audit',{p_branch_id:branchId})
