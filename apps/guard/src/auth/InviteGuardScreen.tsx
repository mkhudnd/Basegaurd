import React,{useEffect,useState} from 'react';
import {ActivityIndicator,Pressable,SafeAreaView,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import {supabase} from '../api';

type Site={id:string;name:string;code:string};
type Props={onClose?:()=>void};
export function InviteGuardScreen({onClose}:Props){
 const [sites,setSites]=useState<Site[]>([]);const [siteId,setSiteId]=useState('');
 const [name,setName]=useState('');const [email,setEmail]=useState('');
 const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');const [success,setSuccess]=useState('');
 useEffect(()=>{let current=true;(async()=>{
  try{
   const {data:{user},error:authError}=await supabase.auth.getUser();if(authError||!user)throw Error('Sign in to invite staff.');
   const {data:assignments,error:assignError}=await supabase.from('site_assignments').select('site_id').eq('user_id',user.id).in('role_at_site',['supervisor','admin']);
   if(assignError)throw assignError;
   const ids=[...new Set((assignments||[]).map(x=>x.site_id))];
   if(!ids.length){if(current)setSites([]);return;}
   const {data:available,error:siteError}=await supabase.from('sites').select('id,name,code').in('id',ids).eq('is_active',true);
   if(siteError)throw siteError;if(current){setSites(available||[]);if(available?.length)setSiteId(available[0].id);}
  }catch(e){if(current)setError(e instanceof Error?e.message:'Could not load authorized sites.');}
  finally{if(current)setLoading(false);}
 })();return ()=>{current=false;};},[]);
 async function invite(){setError('');setSuccess('');setBusy(true);
  try{
   if(name.trim().length<2||name.trim().length>120)throw Error('Enter the guard’s full name.');
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))throw Error('Enter a valid email address.');
   if(!siteId)throw Error('Choose an authorized site.');
   const {data,error:invokeError}=await supabase.functions.invoke('invite-guard',{
    body:{email:email.trim().toLowerCase(),display_name:name.trim(),site_id:siteId},
   });
   if(invokeError)throw invokeError;
   if(!data?.ok)throw Error(data?.error||'Invitation failed.');
   setSuccess('Invitation sent. The guard will receive a link to set their password and activate their account.');
   setName('');setEmail('');
  }catch(e){setError(e instanceof Error?e.message:'Could not send invitation.');}
  finally{setBusy(false);}
 }
 return <SafeAreaView style={styles.page}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
  <View style={styles.heading}><Text style={styles.title}>Add a guard</Text>{onClose&&<Pressable onPress={onClose} accessibilityRole="button"><Text style={styles.link}>Close</Text></Pressable>}</View>
  <Text style={styles.info}>Invite an authorized security officer. Only supervisors assigned to a site can invite guards to it.</Text>
  {loading?<ActivityIndicator color="#174E42"/>:<>
   <Text style={styles.label}>Full name</Text><TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Guard's name" autoCapitalize="words"/>
   <Text style={styles.label}>Work email</Text><TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="guard@example.com" keyboardType="email-address" autoCapitalize="none" autoCorrect={false}/>
   <Text style={styles.label}>Assigned site</Text>
   {sites.length?sites.map(site=><Pressable key={site.id} onPress={()=>setSiteId(site.id)} style={[styles.siteRow,siteId===site.id&&styles.selected]} accessibilityRole="radio" accessibilityState={{checked:siteId===site.id}}>
    <Text style={styles.siteText}>{site.name} · {site.code}</Text><Text style={{color:'#174E42'}}>{siteId===site.id?'●':'○'}</Text>
   </Pressable>):<Text style={styles.error}>No authorized active site found for this supervisor.</Text>}
   {!!error&&<Text style={styles.error}>{error}</Text>}{!!success&&<Text style={styles.success}>{success}</Text>}
   <Pressable accessibilityRole="button" disabled={busy||!sites.length} style={[styles.button,(busy||!sites.length)&&{opacity:.55}]} onPress={()=>void invite()}>
    {busy?<ActivityIndicator color="#fff"/>:<Text style={styles.buttonText}>Send invitation</Text>}
   </Pressable>
   <Text style={styles.info}>The invitation is email-based. Accounts cannot be created from the public sign-in screen. Assignments and invitations are recorded server-side.</Text>
  </>}
 </ScrollView></SafeAreaView>;
}
const styles=StyleSheet.create({page:{flex:1,backgroundColor:'#F6F8F9'},scroll:{padding:20,gap:12,paddingBottom:46},heading:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},title:{fontSize:25,fontWeight:'800',color:'#152836'},info:{color:'#657789',lineHeight:20},label:{fontSize:14,fontWeight:'700',color:'#152836',marginTop:8},input:{minHeight:54,borderWidth:1,borderColor:'#D1D9E1',backgroundColor:'white',borderRadius:10,padding:13,fontSize:16},siteRow:{minHeight:52,flexDirection:'row',alignItems:'center',justifyContent:'space-between',padding:14,borderRadius:10,borderWidth:1,borderColor:'#D1D9E1',backgroundColor:'white'},selected:{borderColor:'#174E42',backgroundColor:'#EAF3EE'},siteText:{fontSize:14,color:'#152836',flex:1},link:{color:'#174E42',fontWeight:'700'},error:{color:'#A22D2D'},success:{color:'#17683B',lineHeight:20},button:{minHeight:54,borderRadius:10,backgroundColor:'#174E42',alignItems:'center',justifyContent:'center',marginTop:6},buttonText:{color:'white',fontWeight:'700',fontSize:16}});
