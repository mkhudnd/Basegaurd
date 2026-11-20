export type HandoverOperation={id:string;kind:'submit'|'receive';payload:string};
type Storage={
 runAsync(sql:string,...args:string[]):Promise<unknown>;
 getAllAsync<T>(sql:string,...args:string[]):Promise<T[]>;
};
export const handoverTable=`CREATE TABLE IF NOT EXISTS handover_ops (
 actor TEXT NOT NULL,id TEXT NOT NULL,kind TEXT NOT NULL,slot TEXT NOT NULL,
 payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'queued',error TEXT,PRIMARY KEY(actor,kind,slot))`;

export async function enqueueHandover(d:Storage,actor:string,kind:HandoverOperation['kind'],slot:string,args:{p_id:string}&Record<string,unknown>){
 await d.runAsync('INSERT OR IGNORE INTO handover_ops(actor,id,kind,slot,payload) VALUES(?,?,?,?,?)',
  actor,args.p_id,kind,slot,JSON.stringify(args));
 const [stored]=await d.getAllAsync<{payload:string}>('SELECT payload FROM handover_ops WHERE actor=? AND kind=? AND slot=?',actor,kind,slot);
 if(!stored || JSON.stringify({...JSON.parse(stored.payload),p_id:args.p_id})!==JSON.stringify(args))
  throw new Error('A different handover is already saved for this shift. Review the saved handover before retrying.');
}
export async function replayHandovers(d:Storage,actor:string,submit:(op:HandoverOperation)=>Promise<{id:string;received_at:string}>){
 const result={sent:0,failed:0};
 const ops=await d.getAllAsync<HandoverOperation>("SELECT id,kind,payload FROM handover_ops WHERE actor=? AND state<>'received' ORDER BY rowid",actor);
 for(const op of ops){
  try{
   const receipt=await submit(op);
   if(receipt?.id!==op.id||!Number.isFinite(Date.parse(receipt.received_at)))throw new Error('Invalid handover receipt');
   await d.runAsync("UPDATE handover_ops SET state='received',error=NULL WHERE actor=? AND kind=? AND id=?",actor,op.kind,op.id);
   result.sent++;
  }catch(e){
   await d.runAsync("UPDATE handover_ops SET state='failed',error=? WHERE actor=? AND kind=? AND id=?",String(e),actor,op.kind,op.id);
   result.failed++;
  }
 }
 return result;
}
