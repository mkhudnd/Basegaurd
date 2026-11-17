import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {createClient} from 'npm:@supabase/supabase-js@2.75.0';

/**
 * Baseguard SmartOps guard provisioning.
 * Must be deployed with JWT verification ENABLED.
 * Uses the project service role ONLY in the Edge Function, never in apps.
 */
const url=Deno.env.get('SUPABASE_URL')||'';
const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const admin=createClient(url,serviceKey,{auth:{autoRefreshToken:false,persistSession:false}});
const redirectTo='baseguard-smartops://auth/callback?flow=invite';
const emailRE=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uuidRE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JSONHeaders={'Content-Type':'application/json','Cache-Control':'no-store'};
function json(status:number,obj:Record<string,unknown>){return new Response(JSON.stringify(obj),{status,headers:JSONHeaders});}

Deno.serve(async (req:Request)=>{
 if(req.method!=='POST')return json(405,{ok:false,error:'Method not allowed'});
 if(!url||!serviceKey)return json(503,{ok:false,error:'Server configuration incomplete'});
 const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
 if(!token)return json(401,{ok:false,error:'Authentication required'});
 const {data:identity,error:identityError}=await admin.auth.getUser(token);
 if(identityError||!identity.user)return json(401,{ok:false,error:'Invalid or expired session'});
 const actorId=identity.user.id;
 let body:Record<string,unknown>;
 try{body=await req.json();}catch{return json(400,{ok:false,error:'Invalid request'});}
 const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
 const displayName=typeof body.display_name==='string'?body.display_name.trim():'';
 const siteId=typeof body.site_id==='string'?body.site_id:'';
 if(!emailRE.test(email)||email.length>254||displayName.length<2||displayName.length>120||!uuidRE.test(siteId))
   return json(400,{ok:false,error:'Provide a valid name, email and site'});

 // Use server-fetched authorization state, NEVER a role or site list supplied by the client.
 const {data:actor,error:actorError}=await admin.from('profiles').select('role,is_active').eq('id',actorId).single();
 if(actorError||!actor?.is_active||!['supervisor','admin'].includes(actor.role))
  return json(403,{ok:false,error:'Supervisor or administrator access required'});
 const now=new Date().toISOString();
 const [{data:site,error:siteError},{data:assignments,error:assignmentError}]=await Promise.all([
  admin.from('sites').select('id').eq('id',siteId).eq('is_active',true).maybeSingle(),
  admin.from('site_assignments').select('id,valid_from,valid_to').eq('user_id',actorId).eq('site_id',siteId)
   .eq('role_at_site',actor.role),
 ]);
 const hasValidAssignment=(assignments||[]).some(a=>new Date(a.valid_from).getTime()<=Date.now()&&(!a.valid_to||new Date(a.valid_to).getTime()>Date.now()));
 if(siteError||assignmentError||!site||!hasValidAssignment)return json(403,{ok:false,error:'Not authorized to manage this site'});

 const since=new Date(Date.now()-60*60*1000).toISOString();
 const {count, error:countError}=await admin.from('audit_events').select('id',{count:'exact',head:true})
  .eq('actor_id',actorId).eq('action','guard.invited').gte('created_at',since);
 if(countError)return json(500,{ok:false,error:'Unable to check invitation limits'});
 if((count||0)>=10)return json(429,{ok:false,error:'Hourly invitation limit reached. Try again later.'});

 // An already-created Auth user must be assigned via a separate controlled management flow.
 // Supabase Auth inviteUserByEmail rejects existing accounts; do not silently override roles.
 const {data:invite,error:inviteError}=await admin.auth.admin.inviteUserByEmail(email,{redirectTo,data:{full_name:displayName}});
 if(inviteError||!invite.user){
  return json(409,{ok:false,error:'Unable to invite this address. It may already have an account, or email delivery may be unavailable.'});
 }
 const userId=invite.user.id;
 const {error:profileError}=await admin.from('profiles').insert({id:userId,display_name:displayName,role:'guard',is_active:true});
 if(profileError){
  // Fail closed: invitee cannot view operational data without a valid profile/assignment.
  return json(500,{ok:false,error:'Invite created, but provisioning failed. Contact an administrator; do not send another invitation.'});
 }
 const {error:assignmentInsertError}=await admin.from('site_assignments').insert({
  user_id:userId,site_id:siteId,role_at_site:'guard',valid_from:now,
 });
 if(assignmentInsertError){
  // Fail closed: no site access; require admin reconciliation.
  await admin.from('profiles').update({is_active:false}).eq('id',userId);
  return json(500,{ok:false,error:'Account invited but site assignment failed. Administrator review required.'});
 }
 await admin.from('audit_events').insert({actor_id:actorId,site_id:siteId,action:'guard.invited',entity_ref:userId});
 return json(200,{ok:true,message:'Guard invited and assigned to the site'});
});
