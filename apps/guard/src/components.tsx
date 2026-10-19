import React from 'react';
import {Pressable, StyleSheet, Text, TextInput, View, type KeyboardTypeOptions} from 'react-native';
import {statusLabel, type RecordState} from './incident-domain';

export const colors = {green:'#174E42', navy:'#152836', background:'#F6F8F9', white:'#FFFFFF', danger:'#B43732', offline:'#73549B', text:'#17252D', muted:'#556771', border:'#D9E2E6', soft:'#E7F2EE'};
export function Button({label,onPress,variant='primary',disabled=false}: {label:string;onPress:()=>void;variant?:'primary'|'secondary'|'danger';disabled?:boolean}) {
 return <Pressable accessibilityRole="button" accessibilityState={{disabled}} onPress={onPress} disabled={disabled}
  style={[styles.button,variant==='secondary'&&styles.secondary,variant==='danger'&&styles.danger,disabled&&styles.disabled]}>
  <Text style={[styles.buttonText,variant==='secondary'&&styles.secondaryText]}>{label}</Text>
 </Pressable>;
}
export function Card({children}: {children:React.ReactNode}) {return <View style={styles.card}>{children}</View>;}
export function Field({label,value,onChange,placeholder,multiline=false,secure=false,keyboardType='default'}: {label:string;value:string;onChange:(v:string)=>void;placeholder?:string;multiline?:boolean;secure?:boolean;keyboardType?:KeyboardTypeOptions}) {
 return <View style={styles.fieldWrap}><Text style={styles.fieldLabel}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} placeholder={placeholder}
  placeholderTextColor={colors.muted} multiline={multiline} secureTextEntry={secure} keyboardType={keyboardType}
  autoCapitalize={secure||keyboardType==='email-address'?'none':'sentences'} style={[styles.input,multiline&&styles.multiline]}/></View>;
}
export function ChoiceGroup({label,options,value,onChange}: {label:string;options:readonly string[];value:string;onChange:(value:string)=>void}) {
 return <View style={{gap:8}}><Text style={styles.fieldLabel}>{label}</Text><View style={styles.choices}>{options.map(option=><Pressable key={option}
  accessibilityRole="radio" accessibilityState={{selected:value===option}} onPress={()=>onChange(option)} style={[styles.choice,value===option&&styles.choiceOn]}>
  <Text style={[styles.choiceText,value===option&&styles.choiceTextOn]}>{option.charAt(0).toUpperCase()+option.slice(1)}</Text></Pressable>)}</View></View>;
}
export function StatusChip({state}: {state:RecordState}) {
 const color=state==='received'?colors.green:state==='failed'?colors.danger:colors.offline;
 return <View style={[styles.chip,{backgroundColor:state==='received'?colors.soft:state==='failed'?'#FCEAE7':'#F0EAF8'}]}>
  <Text style={{color,fontWeight:'700',fontSize:12}}>{statusLabel(state)}</Text></View>;
}
export function ConnectionIndicator({pending,onPress}: {pending:number;onPress:()=>void}) {
 return <Pressable accessibilityRole="button" onPress={onPress} style={styles.connection}><Text style={styles.connectionText}>{pending} awaiting sync · Queue</Text></Pressable>;
}
export const typography = StyleSheet.create({title:{fontSize:24,lineHeight:32,fontWeight:'700',color:colors.navy},heading:{fontSize:17,lineHeight:24,fontWeight:'700',color:colors.navy},body:{fontSize:15,lineHeight:23,color:colors.text},muted:{fontSize:13,lineHeight:20,color:colors.muted},error:{fontSize:14,lineHeight:21,color:colors.danger}});
const styles=StyleSheet.create({
 button:{minHeight:52,borderRadius:12,backgroundColor:colors.green,alignItems:'center',justifyContent:'center',paddingHorizontal:16},
 secondary:{backgroundColor:'#EAF0F2'},danger:{backgroundColor:colors.danger},disabled:{opacity:.48},
 buttonText:{fontSize:15,fontWeight:'700',color:colors.white,textAlign:'center'},secondaryText:{color:colors.navy},
 card:{backgroundColor:colors.white,borderWidth:1,borderColor:colors.border,borderRadius:16,padding:16,gap:12},
 fieldWrap:{gap:8},fieldLabel:{fontSize:14,fontWeight:'700',color:colors.navy},
 input:{backgroundColor:colors.white,borderColor:colors.border,borderWidth:1,borderRadius:10,minHeight:52,paddingHorizontal:14,paddingVertical:12,color:colors.text,fontSize:16},
 multiline:{minHeight:112,textAlignVertical:'top'},choices:{flexDirection:'row',flexWrap:'wrap',gap:8},
 choice:{minHeight:48,borderRadius:10,backgroundColor:'#EEF2F4',borderWidth:1,borderColor:colors.border,paddingHorizontal:14,justifyContent:'center'},
 choiceOn:{backgroundColor:colors.green,borderColor:colors.green},choiceText:{fontSize:14,color:colors.navy},choiceTextOn:{color:colors.white,fontWeight:'700'},
 chip:{alignSelf:'flex-start',borderRadius:30,paddingHorizontal:10,paddingVertical:7},
 connection:{minHeight:48,justifyContent:'center',paddingHorizontal:10,borderRadius:24,backgroundColor:'#F0EAF8'},
 connectionText:{fontSize:12,fontWeight:'700',color:colors.offline}
});
