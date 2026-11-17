import React,{useState} from 'react';
import {ActivityIndicator,Pressable,SafeAreaView,StyleSheet,Text,TextInput,View} from 'react-native';
import {supabase} from '../api';
import type {AuthFlow} from './AuthLinks';

type Props={flow:AuthFlow;onComplete:()=>void};
export function SetPasswordScreen({flow,onComplete}:Props){
 const [password,setPassword]=useState('');const [confirm,setConfirm]=useState('');
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 async function submit(){
  setError('');if(password.length<12){setError('Use at least 12 characters.');return;}
  if(password!==confirm){setError('Passwords do not match.');return;}
  setBusy(true);try{const {error:saveError}=await supabase.auth.updateUser({password});
   if(saveError)throw saveError;onComplete();
  }catch(e){setError(e instanceof Error?e.message:'Could not save password.');}
  finally{setBusy(false);}
 }
 return <SafeAreaView style={styles.page}><View style={styles.card}>
  <Text style={styles.title}>{flow==='invite'?'Finish your account':'Choose a new password'}</Text>
  <Text style={styles.detail}>{flow==='invite'?'Your account has been invited by Baseguard. Choose a password to continue.':'Set a new password to restore account access.'}</Text>
  <Text style={styles.label}>New password</Text>
  <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry placeholder="At least 12 characters" autoCapitalize="none" textContentType="newPassword"/>
  <Text style={styles.label}>Confirm password</Text>
  <TextInput style={styles.input} value={confirm} onChangeText={setConfirm} secureTextEntry placeholder="Repeat your password" autoCapitalize="none" textContentType="newPassword"/>
  {!!error&&<Text style={styles.error}>{error}</Text>}
  <Pressable onPress={()=>void submit()} disabled={busy} style={[styles.button,busy&&{opacity:.6}]}>
   {busy?<ActivityIndicator color="white"/>:<Text style={styles.buttonText}>Save password & continue</Text>}
  </Pressable>
 </View></SafeAreaView>;
}
const styles=StyleSheet.create({page:{flex:1,backgroundColor:'#F6F8F9',justifyContent:'center',padding:20},card:{backgroundColor:'white',borderRadius:16,padding:22,gap:10},title:{fontSize:24,fontWeight:'800',color:'#152836'},detail:{fontSize:14,color:'#637487',lineHeight:21,marginBottom:10},label:{color:'#152836',fontWeight:'700'},input:{borderWidth:1,borderColor:'#D1DAE4',borderRadius:10,minHeight:54,padding:14,fontSize:16},error:{color:'#A22D2D'},button:{backgroundColor:'#174E42',borderRadius:10,marginTop:10,minHeight:54,alignItems:'center',justifyContent:'center'},buttonText:{color:'#fff',fontWeight:'700',fontSize:16}});
