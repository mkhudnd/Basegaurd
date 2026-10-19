import {confirmedReceipt} from './incident-domain.ts';

export type PendingRecord = {id:string;kind:'incident'|'occurrence';payload:string};
export type SyncAdapter = {
 pending:(guardId:string)=>Promise<PendingRecord[]>;
 markSending:(id:string)=>Promise<void>;
 submit:(kind:PendingRecord['kind'],payload:Record<string,unknown>)=>Promise<unknown>;
 markReceived:(id:string,receivedAt:string,publicNumber:string|null)=>Promise<void>;
 markFailed:(id:string,error:string)=>Promise<void>;
 onStateChange?:()=>Promise<void> | void;
};
export async function syncPending(guardId:string,adapter:SyncAdapter):Promise<{sent:number;failed:number}> {
 const pending=await adapter.pending(guardId);
 let sent=0,failed=0;
 const notify=async()=>{try{await adapter.onStateChange?.();}catch{ /* UI refresh cannot change delivery outcome. */ }};
 for(const item of pending){
  await adapter.markSending(item.id);
  await notify();
  try{
   const args=JSON.parse(item.payload) as Record<string,unknown>;
   if(args.p_id!==item.id) throw new Error('Local operation ID mismatch');
   const response=await adapter.submit(item.kind,args);
   const receipt=confirmedReceipt(response,item.id,item.kind);
   await adapter.markReceived(item.id,receipt.receivedAt,receipt.publicNumber);
   await notify();
   sent++;
  }catch(e){
   failed++;
   await adapter.markFailed(item.id,(e instanceof Error?e.message:'Submission failed').slice(0,250));
   await notify();
  }
 }
 return {sent,failed};
}
