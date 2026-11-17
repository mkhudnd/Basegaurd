import {Linking} from 'react-native';
import {supabase} from '../api';

export type AuthFlow='invite'|'recovery';

type Options={onFlow:(flow:AuthFlow)=>void;onError:(error:string)=>void};

/** Explicitly handles Supabase redirects; detectSessionInUrl is false in React Native. */
export function watchAuthLinks({onFlow,onError}:Options){
  let disposed=false;
  let active=false;
  async function handle(url:string|null){
    if(!url||disposed||!url.startsWith('baseguard-smartops://auth/callback')||active)return;
    active=true;
    try{
      const [queryPart='',hashPart='']=url.split('?').slice(1).join('?').split('#');
      const query=new URLSearchParams(queryPart);
      const hash=new URLSearchParams(hashPart||url.split('#')[1]||'');
      const field=(key:string)=>hash.get(key)||query.get(key);
      const incomingError=field('error_description')||field('error');
      if(incomingError)throw new Error(incomingError);
      const flow=field('flow')||field('type');
      const code=field('code');
      if(code){const {error}=await supabase.auth.exchangeCodeForSession(code);if(error)throw error;if(flow==='invite'||flow==='recovery')onFlow(flow);return;}
      const tokenHash=field('token_hash');
      if(tokenHash && (flow==='invite'||flow==='recovery')){
        const {error}=await supabase.auth.verifyOtp({token_hash:tokenHash,type:flow});
        if(error)throw error;
        onFlow(flow);return;
      }
      const access_token=field('access_token'), refresh_token=field('refresh_token');
      if(access_token&&refresh_token){
        const {error}=await supabase.auth.setSession({access_token,refresh_token});if(error)throw error;
        if(flow==='invite'||flow==='recovery')onFlow(flow);return;
      }
      throw Error('This sign-in link is incomplete or expired. Request another invitation or reset link.');
    }catch(e){onError(e instanceof Error?e.message:'Unable to open account link.');}
    finally{active=false;}
  }
  const listener=Linking.addEventListener('url',event=>{void handle(event.url);});
  void Linking.getInitialURL().then(url=>handle(url)).catch(()=>{});
  return ()=>{disposed=true;listener.remove();};
}
