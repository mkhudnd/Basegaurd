import React from 'react';
import {Text,View,StyleSheet} from 'react-native';
import {Button,Card,ChoiceGroup,colors,Field,typography} from './components';
import {incidentCategories,localDateTime,severities} from './incident-domain';
import type {ReportIncidentScreenProps} from './screen-contracts';

/** Presentation only. The owner supplies validated state and durable-save callback. */
export function ReportIncidentScreen({duty,draft,eventText,validationError,saving,onDraftChange,onEventTextChange,onSave,onCancel}:ReportIncidentScreenProps){
 return <>
  <Text style={typography.title}>Report Incident</Text><Text style={typography.muted}>Record factual observations for your assigned site.</Text>
  <View style={styles.urgent}><Text style={[typography.heading,{color:colors.danger}]}>Urgent safety notice</Text>
   <Text style={typography.body}>Use approved emergency telephone/radio procedures. In-app submission does not dispatch assistance.</Text></View>
  <Card><ChoiceGroup label="Incident category *" options={incidentCategories} value={draft.category} onChange={category=>onDraftChange({...draft,category})}/>
   <ChoiceGroup label="Severity *" options={severities} value={draft.severity} onChange={severity=>onDraftChange({...draft,severity})}/></Card>
  <Card><Field label="Time of incident * (YYYY-MM-DD HH:mm)" value={eventText} onChange={onEventTextChange} placeholder="YYYY-MM-DD HH:mm"/>
   <Button label="Use current time" onPress={()=>onEventTextChange(localDateTime(new Date().toISOString()))} variant="secondary"/>
   <Text style={typography.muted}>Enter the actual event time. The phone save time is recorded separately. Times use this phone's local timezone.</Text></Card>
  <Card><Field label="Factual narrative * (at least 20 characters)" value={draft.narrative} onChange={narrative=>onDraftChange({...draft,narrative})}
   placeholder="Describe what you observed, without speculation." multiline/>
   <Field label="Immediate actions (optional)" value={draft.actions} onChange={actions=>onDraftChange({...draft,actions})} multiline/></Card>
  {!!validationError&&<Text accessibilityRole="alert" style={typography.error}>{validationError}</Text>}
  <Button label={saving?'Saving…':'Save incident on phone'} onPress={onSave} disabled={saving||!duty}/>
  <Button label="Cancel" onPress={onCancel} variant="secondary"/>
 </>;
}
const styles=StyleSheet.create({urgent:{backgroundColor:'#FCEAE7',borderRadius:16,padding:16,gap:8}});
