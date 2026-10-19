import {createClient} from '@supabase/supabase-js';

const url=import.meta.env.VITE_SUPABASE_URL;
const key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if(!url || !key)throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env');
export const supabase=createClient(url,key);

export type Site={id:string;name:string;code:string};
export type Incident={id:string;public_number:string;site_id:string;category:string;severity:string;description:string;status:string;reported_at:string;received_at:string};
export type Occurrence={id:string;site_id:string;category:string;narrative:string;event_at:string;received_at:string};
export type SiteFeed={incidents:Incident[];occurrences:Occurrence[]};

export async function authorizedSites(userId:string):Promise<Site[]> {
 const {data:profile,error}=await supabase.from('profiles').select('role,is_active').eq('id',userId).single();
 if(error)throw error;
 if(!profile?.is_active||!['supervisor','admin'].includes(profile.role))throw new Error('This account is not an active supervisor. Contact Baseguard IT.');
 const {data,error:siteError}=await supabase.from('sites').select('id,name,code').order('name');
 if(siteError)throw siteError;
 return data??[];
}

export async function loadSiteFeed(siteId:string):Promise<SiteFeed> {
 const [inc,ob]=await Promise.all([
  supabase.from('incidents').select('id,public_number,site_id,category,severity,description,status,reported_at,received_at').eq('site_id',siteId).order('received_at',{ascending:false}).limit(100),
  supabase.from('occurrence_entries').select('id,site_id,category,narrative,event_at,received_at').eq('site_id',siteId).order('event_at',{ascending:false}).limit(200)
 ]);
 if(inc.error)throw inc.error;
 if(ob.error)throw ob.error;
 return {incidents:inc.data??[],occurrences:ob.data??[]};
}

export async function acknowledgeIncident(id:string):Promise<void> {
 const {data,error}=await supabase.rpc('acknowledge_incident',
  {p_incident_id:id,p_note:'Reviewed and acknowledged by supervisor'});
 if(error)throw error;
 if(data?.id!==id||!['acknowledged','in_progress','resolved','closed'].includes(data?.status))
  throw new Error('Invalid supervisor acknowledgement response');
}
