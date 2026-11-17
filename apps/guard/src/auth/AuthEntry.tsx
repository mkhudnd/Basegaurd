import React, {useState} from 'react';
import {ActivityIndicator,Pressable,SafeAreaView,StyleSheet,Text,TextInput,View} from 'react-native';
import {supabase} from '../api';
import {LoginScreen} from './LoginScreen';

export const AUTH_CALLBACK_URL='baseguard-smartops://auth/callback';

type Props={errorFromLink?:string};
export function AuthEntry({errorFromLink}:Props){
  const [mode,setMode]=useState<'login'|'forgot'>('login');
  const [email,setEmail]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  async function signIn(workEmail:string,password:string){
    setError('');setBusy(true);
    try{const {error:signInError}=await supabase.auth.signInWithPassword({email:workEmail.trim(),password});
      if(signInError)throw signInError;
    }catch(e){setError(e instanceof Error?e.message:'Could not sign in.');}
    finally{setBusy(false);}
  }
  async function resetPassword(){
    setError('');setMessage('');setBusy(true);
    try{
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))throw Error('Enter a valid work email.');
      const {error:resetError}=await supabase.auth.resetPasswordForEmail(email.trim(),{redirectTo:AUTH_CALLBACK_URL+'?flow=recovery'});
      if(resetError)throw resetError;
      setMessage('If the email belongs to an account, a password-reset link will be sent. Open it on the phone with SmartOps installed.');
    }catch(e){setError(e instanceof Error?e.message:'Unable to request reset.');}
    finally{setBusy(false);}
  }
  if(mode==='login')return <LoginScreen busy={busy} error={error||errorFromLink} onSignIn={signIn}
    onForgotPassword={value=>{setEmail(value);setError('');setMessage('');setMode('forgot');}}/>;
  return <SafeAreaView style={styles.page}><View style={styles.card}>
    <Text style={styles.title}>Reset password</Text>
    <Text style={styles.detail}>Enter the email address on your Baseguard SmartOps account.</Text>
    <TextInput style={styles.input} placeholder="Work email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoCorrect={false} autoComplete="email"/>
    {!!error&&<Text style={styles.error}>{error}</Text>}{!!message&&<Text style={styles.detail}>{message}</Text>}
    <Pressable style={[styles.button,busy&&{opacity:.6}]} disabled={busy} onPress={()=>void resetPassword()}>
      {busy?<ActivityIndicator color="white"/>:<Text style={styles.buttonText}>Send reset link</Text>}
    </Pressable>
    <Pressable onPress={()=>{setMode('login');setError('');setMessage('');}} style={styles.back}><Text style={styles.backText}>Back to sign in</Text></Pressable>
  </View></SafeAreaView>;
}
const styles=StyleSheet.create({page:{flex:1,backgroundColor:'#F6F8F9',justifyContent:'center',padding:20},card:{backgroundColor:'white',padding:22,borderRadius:16,gap:15},
 title:{color:'#152836',fontWeight:'800',fontSize:25},detail:{color:'#65778C',lineHeight:21},input:{height:54,borderWidth:1,borderColor:'#CED8E0',borderRadius:10,padding:13,fontSize:16},
 error:{color:'#A22D2D'},button:{backgroundColor:'#174E42',borderRadius:10,minHeight:54,justifyContent:'center',alignItems:'center'},buttonText:{color:'white',fontWeight:'700',fontSize:16},back:{alignItems:'center',padding:10},backText:{color:'#174E42',fontWeight:'700'}});
