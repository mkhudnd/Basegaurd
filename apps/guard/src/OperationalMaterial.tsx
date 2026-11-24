import React from 'react';
import {Ionicons} from '@expo/vector-icons';
import {Pressable,StyleSheet,Text,View} from 'react-native';
import {COLORS,FONTS} from './components';

type IconName=React.ComponentProps<typeof Ionicons>['name'];

/** Operational Material: presentation only. No duty or offline state is inferred here. */
export function DutySummaryPanel({
 post,site,status,start,scheduledEnd,actionLabel,actionDisabled=false,onAction,notice,
}:{
 post:string;site:string;status:string;start:string;scheduledEnd:string;
 actionLabel:string;actionDisabled?:boolean;onAction:()=>void;notice?:string;
}){
 const active=status.trim().toLowerCase()==='on duty';
 return <View style={s.dutyPanel}>
  <View style={s.dutyTop}>
   <View style={s.dutyCopy}><Text style={s.dutyPost}>{post}</Text><Text style={s.dutySite}>{site}</Text></View>
   <View style={[s.statusPill,!active&&s.statusPillInactive]}><View style={[s.statusDot,!active&&s.statusDotInactive]}/><Text style={[s.statusText,!active&&s.statusTextInactive]}>{status}</Text></View>
  </View>
  <View style={s.times}>
   <View style={s.timeColumn}><Text style={s.timeLabel}>STARTED / SCHEDULED</Text><Text style={s.timeValue}>{start}</Text></View>
   <View style={s.timeColumn}><Text style={s.timeLabel}>SHIFT END</Text><Text style={s.timeValue}>{scheduledEnd}</Text></View>
  </View>
  {notice?<Text accessibilityLiveRegion="polite" style={s.notice}>{notice}</Text>:null}
  <Pressable accessibilityRole="button" accessibilityState={{disabled:actionDisabled}}
   disabled={actionDisabled} onPress={onAction}
   style={({pressed})=>[s.dutyAction,actionDisabled&&s.disabled,pressed&&s.pressed]}>
   <Text style={s.dutyActionLabel}>{actionLabel}</Text>
   <Ionicons name="arrow-forward" size={18} color={COLORS.primary}/>
  </Pressable>
 </View>;
}

export function OperationalTaskRow({title,description,icon,onPress,disabled=false,danger=false}:{
 title:string;description:string;icon:IconName;onPress:()=>void;disabled?:boolean;danger?:boolean;
}){
 return <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${description}`}
  accessibilityState={{disabled}} disabled={disabled} onPress={onPress}
  style={({pressed})=>[s.task,danger&&s.dangerTask,disabled&&s.disabled,pressed&&s.pressed]}>
  <View style={[s.taskIcon,danger&&s.dangerIcon]}>
   <Ionicons name={icon} size={21} color={danger?COLORS.danger:COLORS.primary}/>
  </View>
  <View style={s.taskCopy}><Text style={[s.taskTitle,danger&&s.dangerText]}>{title}</Text>
   <Text style={s.taskDescription}>{description}</Text></View>
  <Ionicons name="chevron-forward" size={19} color={danger?COLORS.danger:COLORS.textMuted}/>
 </Pressable>;
}

/** Step 3 is record status, not a claim that the incoming guard accepted handover. */
export function EndDutySteps({step}:{step:1|2|3}){
 const labels=['Prepare','Review','Status'];
 return <View style={s.steps} accessibilityLabel={`End Duty step ${step} of 3`}>
  {labels.map((label,index)=>{
   const number=index+1;
   return <View key={label} style={s.step}>
    <View style={[s.stepCircle,number<=step&&s.stepActive]}>
     <Text style={[s.stepNumber,number<=step&&s.stepNumberActive]}>{number<step?'✓':number}</Text>
    </View>
    <Text style={[s.stepLabel,number===step&&s.stepLabelActive]}>{label}</Text>
   </View>;
  })}
 </View>;
}

const s=StyleSheet.create({
 dutyPanel:{backgroundColor:'#F0F7F1',borderLeftWidth:4,borderLeftColor:'#16A34A',borderRadius:14,padding:12,gap:8},
 dutyTop:{flexDirection:'row',alignItems:'flex-start',gap:9,justifyContent:'space-between'},
 dutyCopy:{flex:1,minWidth:0},
 dutyPost:{fontFamily:FONTS.bold,fontWeight:'700',color:COLORS.text,fontSize:19,lineHeight:25},
 dutySite:{fontFamily:FONTS.regular,color:COLORS.textMuted,fontSize:14,lineHeight:21,marginTop:3},
 statusPill:{alignItems:'center',flexDirection:'row',gap:6,paddingHorizontal:10,paddingVertical:7,backgroundColor:'#D4FAE8',borderRadius:999,maxWidth:122},
 statusDot:{width:7,height:7,borderRadius:4,backgroundColor:'#16A34A'},
 statusText:{fontFamily:FONTS.bold,color:'#14532D',fontWeight:'700',fontSize:11,flexShrink:1},
 statusPillInactive:{backgroundColor:'#E6EBE7'},statusDotInactive:{backgroundColor:'#748579'},statusTextInactive:{color:'#46584D'},
 times:{flexDirection:'row',gap:12},timeColumn:{flex:1,minWidth:0},
 timeLabel:{fontFamily:FONTS.medium,fontSize:10,color:COLORS.textMuted,fontWeight:'600',letterSpacing:0.25},
 timeValue:{fontFamily:FONTS.bold,fontWeight:'700',color:COLORS.text,fontSize:16,marginTop:5},
 notice:{fontFamily:FONTS.regular,color:COLORS.textMuted,fontSize:13,lineHeight:19},
 dutyAction:{borderWidth:1,borderColor:'#8FA99A',minHeight:48,borderRadius:11,backgroundColor:'#FFFFFF',alignItems:'center',justifyContent:'center',flexDirection:'row',gap:8,paddingHorizontal:12},
 dutyActionLabel:{fontFamily:FONTS.bold,fontWeight:'700',color:COLORS.primary,fontSize:14},
 task:{flexDirection:'row',alignItems:'center',gap:12,minHeight:70,borderWidth:1,borderColor:COLORS.border,backgroundColor:COLORS.surface,padding:12,borderRadius:13,marginBottom:8},
 taskIcon:{height:40,width:40,backgroundColor:'#E4F3E8',borderRadius:11,alignItems:'center',justifyContent:'center'},
 taskCopy:{flex:1,minWidth:0,gap:3},taskTitle:{fontFamily:FONTS.bold,color:COLORS.text,fontSize:15,fontWeight:'700'},
 taskDescription:{fontFamily:FONTS.regular,color:COLORS.textMuted,fontSize:12,lineHeight:17},
 dangerTask:{backgroundColor:'#FFF6F4',borderColor:'#F1D2CD'},dangerIcon:{backgroundColor:'#FCE5E1'},dangerText:{color:COLORS.danger},
 disabled:{opacity:0.47},pressed:{opacity:0.75},
 steps:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:12},step:{flex:1,alignItems:'center',gap:6},
 stepCircle:{width:29,height:29,borderRadius:15,backgroundColor:'#E7EBE8',alignItems:'center',justifyContent:'center'},
 stepActive:{backgroundColor:COLORS.primary},stepNumber:{fontFamily:FONTS.bold,color:COLORS.textMuted,fontSize:12},
 stepNumberActive:{color:'#FFFFFF'},stepLabel:{fontFamily:FONTS.medium,color:COLORS.textMuted,fontSize:12},stepLabelActive:{color:COLORS.primary,fontWeight:'700'},
});
