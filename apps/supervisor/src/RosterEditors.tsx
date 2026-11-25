import {useEffect,useRef,useState,type FormEvent,type ReactNode} from 'react';
import {Button,Dialog,Input,Select} from './ui';
import {listSecurityPosts,type Site} from './service';
import {bookingWindow,canFollow,dayLabel,editableInstant,errorCode,localField,requestOperation,
  rosterActions,rosterError,rosterTime,type Coverage,type RosterShift} from './roster-domain';
import {getRosterCoverage,getRosterShift,listEligibleGuards,listRoster,saveRosterMutation,
  type RosterMutation,type RosterWindow} from './roster-service';

type Resource<T> = {state:'loading'} | {state:'ready';value:T} | {state:'error';error:unknown};
export function useRosterResource<T>(key:string,load:(signal:AbortSignal)=>Promise<T>):Resource<T> {
  const [entry,setEntry]=useState<{key:string;result:Resource<T>}>();
  const loader=useRef(load);
  loader.current=load;
  useEffect(()=>{
    const request=new AbortController();
    void loader.current(request.signal).then(
      value=>{if (!request.signal.aborted) setEntry({key,result:{state:'ready',value}});},
      error=>{if (!request.signal.aborted) setEntry({key,result:{state:'error',error}});},
    );
    return ()=>request.abort();
  },[key]);
  return entry?.key===key ? entry.result : {state:'loading'};
}

type Mutation = {
  action:RosterMutation; fields:Record<string,unknown>; id:string|null; revision:number; status:string;
};
type EditorProps = {operations:Map<string,string>; close:()=>void; saved:(message:string)=>void};
type ReloadResult = {summary:string; adopt:()=>void};

function SaveEditor({title,close,submit,disabled,reload,children,operations,onSaved,button='Save'}:{
  title:string; close:()=>void; submit:()=>Mutation; disabled?:boolean; reload?:(signal:AbortSignal)=>Promise<ReloadResult>;
  children:ReactNode; operations:Map<string,string>; onSaved:()=>void; button?:string;
}) {
  const lock=useRef(false);
  const reloadRequest=useRef<AbortController | null>(null);
  const [busy,setBusy]=useState(false);
  const [failure,setFailure]=useState('');
  const [stale,setStale]=useState(false);
  const [review,setReview]=useState<ReloadResult>();
  useEffect(()=>()=>reloadRequest.current?.abort(),[]);
  async function save(event:FormEvent) {
    event.preventDefault();
    if (lock.current || stale || disabled) return;
    lock.current=true;setBusy(true);setFailure('');
    try {
      const mutation=submit();
      const operation=requestOperation(operations,mutation.action,mutation.fields);
      await saveRosterMutation(mutation.action,mutation.fields,operation.id,mutation);
      operations.delete(operation.key);
      onSaved();
    } catch(error) {
      setFailure(rosterError(error));
      setStale(errorCode(error)==='PT412');
    } finally {lock.current=false;setBusy(false);}
  }
  async function reviewLatest() {
    if (!reload || lock.current) return;
    const controller=new AbortController();
    reloadRequest.current=controller;
    lock.current=true;setBusy(true);
    try {
      const latest=await reload(controller.signal);
      if (!controller.signal.aborted) {setReview(latest);setFailure('');}
    } catch(error) {if (!controller.signal.aborted) setFailure(rosterError(error));}
    finally {lock.current=false;if (!controller.signal.aborted) setBusy(false);}
  }
  return <Dialog title={title} onClose={()=>{if (!lock.current) close();}}>
    <form className="site-form roster-form" onSubmit={save}>
      <fieldset disabled={busy}>{children}</fieldset>
      {failure&&<p role="alert" className="error">{failure}</p>}
      {stale&&<div className="roster-review">
        <p>Your draft is still in the form.</p>
        {review ? <><p>{review.summary}</p><Button disabled={busy} onClick={()=>{
          review.adopt();setStale(false);setReview(undefined);
        }}>Use latest revision and keep draft</Button></>
          : <Button disabled={busy||!reload} onClick={reviewLatest}>Reload and review</Button>}
      </div>}
      <div className="modal-actions"><Button disabled={busy} onClick={close}>Back</Button>
        <Button type="submit" variant="primary" disabled={busy||stale||disabled}>{busy?'Working…':button}</Button></div>
    </form>
  </Dialog>;
}

export function ReconcileDutyEditor({shift,...props}:EditorProps & {shift:RosterShift}) {
  const [base,setBase]=useState(shift);
  const [reason,setReason]=useState('');
  const [reviewed,setReviewed]=useState(false);
  return <SaveEditor title="Reconcile overdue duty" close={props.close} operations={props.operations}
    button="Reconcile duty" disabled={!base.can_reconcile||!reason.trim()||!reviewed}
    onSaved={()=>props.saved('Administrative reconciliation confirmed by the server.')}
    submit={()=>({action:'reconcile_overdue_duty',id:base.id,revision:base.scheduling_revision+1,status:'completed',
      fields:{p_shift_id:base.id,p_site_id:base.site_id,p_expected_revision:base.scheduling_revision,p_reason:reason.trim()}})}
    reload={async signal=>{
      const latest=await getRosterShift(base.site_id,base.id,signal);
      if (!latest) throw new Error('Shift details are no longer available.');
      return {summary:latest.can_reconcile?'This duty is still overdue and eligible for reconciliation.':
        'This duty is no longer eligible for reconciliation.',
        adopt:()=>{setBase(latest);setReviewed(false);}};
    }}>
    <p>Closes the active assignment with checkout recorded as unknown. Any handover still requires the assigned guards.</p>
    <label>Reason<textarea required maxLength={1000} rows={4} value={reason} onChange={event=>setReason(event.target.value)}/></label>
    <label><input type="checkbox" checked={reviewed} onChange={event=>setReviewed(event.target.checked)}/>
      I understand the server cannot verify which records are still queued on the guard’s phone.</label>
  </SaveEditor>;
}

const startOfDay=(day:string)=>day+'T00:00';
const defaultDayHelp='Enter both dates explicitly for a shift that ends the following day.';

export function ShiftEditor({shift,sites,initialSiteId,names,protectedIncoming,...props}:EditorProps & {
  shift?:RosterShift;sites:Site[];initialSiteId:string;names:Record<string,string>;protectedIncoming:(id:string)=>boolean;
}) {
  const [base,setBase]=useState(shift);
  const [siteId,setSiteId]=useState(initialSiteId);
  const [postId,setPost]=useState(shift?.security_post_id??'');
  const [guardId,setGuard]=useState(shift?.guard_id??'');
  const [successor,setSuccessor]=useState(shift?.successor_shift_id??'');
  const [kind,setKind]=useState(shift?.shift_kind??'custom');
  const [start,setStart]=useState(shift?localField(bookingWindow(shift).start):'');
  const [end,setEnd]=useState(shift&&bookingWindow(shift).end?localField(bookingWindow(shift).end!):'');
  const [attempt,setAttempt]=useState(0);
  const startsAt=editableInstant(start,base?.scheduled_start_at??base?.started_at);
  const endsAt=editableInstant(end,base?.scheduled_end_at??base?.ended_at);
  const validWindow=Boolean(startsAt&&endsAt&&Date.parse(startsAt)>Date.now()&&
    Date.parse(endsAt)>Date.parse(startsAt));
  const eligibleWindow=validWindow&&Date.parse(endsAt!)-Date.parse(startsAt!)<=31*86400000;
  const posts=useRosterResource(JSON.stringify([siteId,attempt]),signal=>listSecurityPosts(siteId,signal));
  const guards=useRosterResource(JSON.stringify([siteId,startsAt,endsAt,attempt]),signal=>eligibleWindow
    ? listEligibleGuards(siteId,{start:startsAt!,end:endsAt!},signal) : Promise.resolve([]));
  const relief=useRosterResource(JSON.stringify([siteId,endsAt,postId,attempt]),signal=>eligibleWindow&&postId
    ? listRoster(siteId,{start:endsAt!,end:new Date(Date.parse(endsAt!)+31*86400000).toISOString()},signal,postId)
    : Promise.resolve([]));
  const guardRows=guards.state==='ready' ? guards.value : [];
  const postRows=posts.state==='ready' ? posts.value.filter(p=>p.is_active) : [];
  const nextRows=relief.state==='ready' ? relief.value.filter(row=>canFollow(row,shift?.id??null,postId,guardId,endsAt??'')) : [];
  const allowedSuccessor=!successor || nextRows.some(row=>row.id===successor) || (
    successor===base?.successor_shift_id && postId===base?.security_post_id &&
    guardId===base?.guard_id && endsAt===bookingWindow(base).end
  );
  const editable=!base || rosterActions(base,Date.now(),protectedIncoming(base.id)).edit;
  const submit=():Mutation=>({
    action:'save_scheduled_shift',
    fields:{p_site_id:siteId,p_shift_id:base?.id??null,p_expected_revision:base?.scheduling_revision??0,
      p_guard_id:guardId,p_post_id:postId,p_start:startsAt,p_end:endsAt,p_kind:kind,p_successor_shift_id:successor||null},
    id:base?.id??null,revision:(base?.scheduling_revision??0)+1,status:'scheduled',
  });
  return <SaveEditor {...props} title={shift?'Edit shift assignment':'Create shift assignment'} submit={submit}
    disabled={!editable||!eligibleWindow||!postRows.some(p=>p.id===postId)||!guardRows.some(g=>g.id===guardId)||!allowedSuccessor}
    reload={base?async signal=>{
      const current=await getRosterShift(siteId,base.id,signal);
      if (!current) throw {code:'42501'};
      const currentWindow=bookingWindow(current);
      return {summary:'Latest server revision '+current.scheduling_revision+' · '+current.status+' · '+
        (current.post??'Post unavailable')+' · '+(names[current.guard_id]??current.guard_id.slice(-8))+' · '+
        rosterTime(currentWindow.start)+' to '+(currentWindow.end?rosterTime(currentWindow.end):'end unavailable'),
      adopt:()=>{setBase(current);setAttempt(value=>value+1);}};
    }:undefined}
    onSaved={()=>props.saved(shift?'Shift update confirmed.':'Shift assignment confirmed.')}>
    <label>Assignment site<Select value={siteId} disabled={Boolean(shift)} onChange={event=>{
      setSiteId(event.target.value);setPost('');setGuard('');setSuccessor('');
    }}>{sites.map(site=><option key={site.id} value={site.id}>{site.name}</option>)}</Select></label>
    <label>Security post<Select value={postId} onChange={event=>{setPost(event.target.value);setSuccessor('');}}>
      <option value="">{posts.state==='loading'?'Loading posts…':'Choose an active post'}</option>
      {postRows.map(post=><option key={post.id} value={post.id}>{post.name} · {post.code}</option>)}
    </Select></label>
    <label>Shift type<Select value={kind} onChange={event=>setKind(event.target.value as typeof kind)}>
      <option value="day">Day</option><option value="night">Night</option><option value="custom">Custom</option>
    </Select></label>
    <div className="roster-form-grid">
      <label>Planned start<Input type="datetime-local" value={start} onInput={event=>setStart(event.currentTarget.value)} required /></label>
      <label>Planned end<Input type="datetime-local" value={end} onInput={event=>setEnd(event.currentTarget.value)} required /></label>
    </div>
    <small>Africa/Harare (UTC+02:00). {defaultDayHelp}</small>
    {start&&end&&!eligibleWindow&&<p className="inline-note">Enter a future start and a later end within 31 days.</p>}
    <label>Eligible guard<Select value={guardId} disabled={!eligibleWindow||guards.state!=='ready'}
      onChange={event=>{setGuard(event.target.value);setSuccessor('');}}>
      <option value="">{guards.state==='loading'?'Checking eligibility…':'Choose a guard'}</option>
      {guardId&&!guardRows.some(row=>row.id===guardId)&&<option value={guardId} disabled>
        {names[guardId]??guardId.slice(-8)} · eligibility unconfirmed
      </option>}
      {guardRows.map(row=><option key={row.id} value={row.id}>{row.display_name}</option>)}
    </Select></label>
    {eligibleWindow&&guards.state==='ready'&&!guardRows.length&&<p className="inline-note">No guard covers this entire interval.</p>}
    <small>Eligibility is advisory. The server checks booking conflicts at save time.</small>
    <label>Successor shift<Select value={successor} onChange={event=>setSuccessor(event.target.value)}
      disabled={!eligibleWindow||!postId||relief.state!=='ready'}>
      <option value="">No successor assigned</option>
      {successor&&!nextRows.some(row=>row.id===successor)&&<option value={successor}>Current successor · {successor.slice(-8)}</option>}
      {nextRows.map(row=><option key={row.id} value={row.id}>{rosterTime(row.started_at)} · {names[row.guard_id]??row.guard_id.slice(-8)}</option>)}
    </Select></label>
    {eligibleWindow&&postId&&relief.state==='ready'&&!nextRows.length&&<small>No matching relief shift in the 31 days after the planned end.</small>}
    {[posts,guards,relief].some(item=>item.state==='error')&&<p className="error" role="alert">
      Some assignment options are unavailable. <Button onClick={()=>setAttempt(value=>value+1)}>Retry options</Button>
    </p>}
    {!editable&&<p role="alert" className="error">The latest shift can no longer be edited.</p>}
  </SaveEditor>;
}

export function CancelShiftEditor({shift,protectedIncoming,...props}:EditorProps & {
  shift:RosterShift;protectedIncoming:(id:string)=>boolean;
}) {
  const [base,setBase]=useState(shift);
  const [reason,setReason]=useState('');
  const editable=rosterActions(base,Date.now(),protectedIncoming(base.id)).cancel;
  return <SaveEditor {...props} title="Cancel shift assignment" button="Confirm cancellation"
    disabled={!editable||reason.trim().length<2} submit={()=>({
      action:'cancel_scheduled_shift',
      fields:{p_site_id:base.site_id,p_shift_id:base.id,p_expected_revision:base.scheduling_revision,p_reason:reason.trim()},
      id:base.id,revision:base.scheduling_revision+1,status:'cancelled',
    })}
    reload={async signal=>{
      const current=await getRosterShift(base.site_id,base.id,signal);
      if (!current) throw {code:'42501'};
      return {summary:'Latest server revision '+current.scheduling_revision+' · '+current.status+' · '+
        rosterTime(bookingWindow(current).start),adopt:()=>setBase(current)};
    }} onSaved={()=>props.saved('Cancellation confirmed.')}>
    <p>The assignment stays in the roster history after cancellation.</p>
    <label>Cancellation reason<textarea className="field" value={reason} onChange={event=>setReason(event.target.value)} required maxLength={500}/></label>
    {!editable&&<p>The latest shift cannot be cancelled.</p>}
  </SaveEditor>;
}

export function CoverageEditor({row,siteId,window,mode,...props}:EditorProps & {
  row:Coverage;siteId:string;window:RosterWindow;mode:'capacity'|'staffing';
}) {
  const capacity=mode==='capacity';
  const [base,setBase]=useState(row);
  const [number,setNumber]=useState(String((capacity?row.booking_capacity:row.required_staffing)??''));
  const [start,setStart]=useState(row.requirement_start_at?localField(row.requirement_start_at):startOfDay(localField(row.start_at).slice(0,10)));
  const [end,setEnd]=useState(row.requirement_end_at?localField(row.requirement_end_at):'');
  const [active,setActive]=useState(true);
  const [detached,setDetached]=useState(false);
  const revision=capacity?base.capacity_revision:base.requirement_revision??0;
  const startsAt=editableInstant(start,base.requirement_start_at);
  const endsAt=editableInstant(end,base.requirement_end_at);
  const invalid=detached||number===''||!Number.isInteger(Number(number))||Number(number)<(capacity?1:0)||Number(number)>100||
    (!capacity&&(!startsAt||!endsAt||Date.parse(endsAt)<=Date.parse(startsAt)));
  return <SaveEditor {...props} title={capacity?'Configure booking capacity':'Configure staffing requirement'} disabled={invalid}
    submit={()=>({
      action:capacity?'save_post_booking_capacity':'save_post_staffing_requirement',
      fields:{p_site_id:siteId,p_post_id:base.post_id,p_expected_revision:revision,
        ...(capacity?{p_capacity:Number(number)}:{p_requirement_id:base.requirement_id,p_start:startsAt,p_end:endsAt,
          p_required_count:Number(number),p_active:active})},
      id:capacity?base.post_id:base.requirement_id,revision:revision+1,status:capacity?'saved':active?'active':'inactive',
    })}
    reload={async signal=>{
      const latest=(await getRosterCoverage(siteId,window,signal)).find(item=>
        item.post_id===base.post_id && (capacity||item.requirement_id===base.requirement_id));
      if (!latest) return {summary:'The configuration no longer exists in this period. Close this form and review coverage.',
        adopt:()=>setDetached(true)};
      return {summary:capacity?'Latest capacity is '+(latest.booking_capacity??'unavailable')+' · revision '+latest.capacity_revision
        :'Latest staffing is '+(latest.required_staffing??'unavailable')+' · revision '+(latest.requirement_revision??0)+
          (latest.requirement_start_at?' · '+rosterTime(latest.requirement_start_at):''),
      adopt:()=>setBase(latest)};
    }} onSaved={()=>props.saved(capacity?'Booking capacity confirmed.':'Staffing requirement confirmed.')}>
    <p><strong>{row.post_name}</strong> · {dayLabel(localField(row.start_at).slice(0,10))}</p>
    <label>{capacity?'Maximum simultaneous bookings':'Required staff'}<Input type="number" min={capacity?1:0} max={100}
      value={number} onInput={event=>setNumber(event.currentTarget.value)} required/></label>
    {!capacity&&<><div className="roster-form-grid">
      <label>Requirement starts<Input type="datetime-local" value={start} onInput={event=>setStart(event.currentTarget.value)} required/></label>
      <label>Requirement ends<Input type="datetime-local" value={end} onInput={event=>setEnd(event.currentTarget.value)} required/></label>
    </div><small>Africa/Harare (UTC+02:00)</small>
    {base.requirement_id&&<label><input type="checkbox" checked={active} onChange={event=>setActive(event.target.checked)}/>Active requirement</label>}</>}
    {detached&&<p role="alert" className="error">Refresh coverage before making a new change to this requirement.</p>}
  </SaveEditor>;
}
