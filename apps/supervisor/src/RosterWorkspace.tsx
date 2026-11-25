import {useEffect,useRef,useState} from 'react';
import {Badge,Button,Card,Dialog,Input,Metrics,Select,Table} from './ui';
import {listSecurityPosts,type Handover,type Site} from './service';
import {bookingWindow,clockTime,coverageValue,dayLabel,occursOnDay,rosterActions,rosterDay,rosterError,
  rosterRange,rosterState,rosterStates,rosterTime,shiftDay,type Coverage,type RosterShift,type RosterView} from './roster-domain';
import {getRosterCoverage,getRosterShift,listRoster} from './roster-service';
import {CancelShiftEditor,CoverageEditor,ReconcileDutyEditor,ShiftEditor,useRosterResource} from './RosterEditors';

type ReferenceShift = Pick<RosterShift,'id'|'site_id'|'guard_id'|'started_at'|'ended_at'> &
  {status:string;post?:string|null;checked_in_at?:string|null;successor_shift_id?:string|null};
type Editor = {type:'create'} | {type:'edit'|'cancel'|'reconcile';shift:RosterShift} | {type:'staffing'|'capacity';row:Coverage};
const short = (id:string) => 'Guard '+id.slice(-8).toUpperCase();
const display = (value:string|null) => value ? rosterTime(value) : 'Unavailable';

export function RosterWorkspace({sites,siteId,onSiteChange,refreshVersion,onRefresh,admin,names,operational,handovers,initialShift}:{
  sites:Site[];siteId:string;onSiteChange:(id:string)=>void;refreshVersion:number;onRefresh:()=>void;
  admin:boolean;names:Record<string,string>;operational?:ReferenceShift[];handovers?:Handover[];
  initialShift?:{siteId:string;shiftId:string};
}) {
  const [date,setDate]=useState(()=>rosterDay(Date.now()));
  const [view,setView]=useState<RosterView>('Week');
  const [post,setPost]=useState('');
  const [guard,setGuard]=useState('');
  const [status,setStatus]=useState('');
  const [coverageId,setCoverageId]=useState('');
  const [detail,setDetail]=useState(initialShift?.siteId===siteId?initialShift.shiftId:'');
  const [editor,setEditor]=useState<Editor>();
  const [notice,setNotice]=useState('');
  const [now,setNow]=useState(Date.now);
  const operationIds=useRef(new Map<string,string>());
  const selectedSite=sites.find(site=>site.id===siteId)??sites[0];
  const activeSite=selectedSite?.id??'';
  const [version,setVersion]=useState(0);
  const loadKey=JSON.stringify([activeSite,refreshVersion,version]);
  const window=rosterRange(date,view);
  const windowKey=JSON.stringify([loadKey,window.start,window.end]);
  const posts=useRosterResource(loadKey,signal=>activeSite?listSecurityPosts(activeSite,signal):Promise.resolve([]));
  const roster=useRosterResource(windowKey,signal=>activeSite?listRoster(activeSite,window,signal):Promise.resolve([]));
  const coverage=useRosterResource(windowKey,signal=>activeSite?getRosterCoverage(activeSite,window,signal):Promise.resolve([]));
  const selected=useRosterResource(JSON.stringify([loadKey,detail]),signal=>detail&&activeSite
    ? getRosterShift(activeSite,detail,signal) : Promise.resolve(null));
  useEffect(()=>{
    const timer=globalThis.setInterval(()=>setNow(Date.now()),30000);
    return ()=>globalThis.clearInterval(timer);
  },[]);
  useEffect(()=>{setPost('');setGuard('');setStatus('');setCoverageId('');
    setDetail(initialShift?.siteId===activeSite?initialShift.shiftId:'');setEditor(undefined);setNotice('');
  },[activeSite,initialShift?.shiftId,initialShift?.siteId]);
  const refresh=()=>{setVersion(value=>value+1);setNow(Date.now());};
  const rosterRows=roster.state==='ready'?roster.value:[];
  const coverageRows=coverage.state==='ready'?coverage.value.filter(row=>!post||row.post_id===post):[];
  const postRows=posts.state==='ready'?posts.value:[];
  const guardIds=[...new Set(rosterRows.map(row=>row.guard_id))].sort((a,b)=>(names[a]??short(a)).localeCompare(names[b]??short(b)));
  const effectiveGuard=guardIds.includes(guard)?guard:'';
  const rows=rosterRows.filter(row=>(!post||row.security_post_id===post)&&(!effectiveGuard||row.guard_id===effectiveGuard)&&
    (!status||rosterState(row,now)===status))
    .sort((a,b)=>Date.parse(bookingWindow(a).start)-Date.parse(bookingWindow(b).start));
  const overdue=(operational??rosterRows).filter(row=>row.site_id===activeSite&&row.status==='active'&&
    row.ended_at&&Date.parse(row.ended_at)<=now);
  const isProtected=(id:string)=>[...rosterRows,...(operational??[])].some(row=>
    row.site_id===activeSite&&row.successor_shift_id===id&&(row.status==='active'||
      (row.status!=='completed'&&Boolean(row.checked_in_at))))||
    Boolean(handovers?.some(row=>row.site_id===activeSite&&row.incoming_shift_id===id&&!row.accepted_at));
  const open=(id:string)=>{setNotice('');setDetail(id);};
  const edit=(next:Editor)=>{setNotice('');setEditor(next);};
  const shift=selected.state==='ready'?selected.value:null;
  const protectedDetail=Boolean(shift&&(isProtected(shift.id)||shift.protected_successor));
  const nextId=shift?.successor_shift_id??'';
  const successor=useRosterResource(JSON.stringify([loadKey,nextId]),signal=>nextId&&activeSite
    ? getRosterShift(activeSite,nextId,signal) : Promise.resolve(null));
  const notify=(message:string)=>{setNotice(message);setEditor(undefined);refresh();onRefresh();};
  const editorProps={close:()=>setEditor(undefined),saved:notify,operations:operationIds.current};
  const selectorKey=(row:Coverage)=>row.post_id+'|'+row.start_at;
  const activeCoverage=coverageRows.find(row=>selectorKey(row)===coverageId)??
    coverageRows.find(row=>Date.parse(row.start_at)<=now&&Date.parse(row.end_at)>now)??coverageRows[0];

  function rosterCard(row:RosterShift,day?:string) {
    const booked=bookingWindow(row);
    const continued=day&&rosterDay(booked.start)!==day;
    const spansMidnight=booked.end&&rosterDay(booked.start)!==rosterDay(booked.end);
    return <button type="button" className="roster-shift" key={row.id} onClick={()=>open(row.id)}>
      <span className="roster-shift-time">{continued?'Continues · ':''}{spansMidnight||continued ?
        rosterTime(booked.start) : clockTime(booked.start)} – {booked.end ?
        (spansMidnight||continued ? rosterTime(booked.end) : clockTime(booked.end)) : 'End unavailable'}</span>
      <strong>{names[row.guard_id]??short(row.guard_id)}</strong>
      <span>{row.post??'Post unavailable'}</span>
      <Badge value={rosterState(row,now)}/>
    </button>;
  }

  if (!selectedSite) return <Card title="Shift scheduling"><p className="empty">No authorized active sites.</p></Card>;
  return <div className="roster-workspace sections">
    {notice&&<p role="status" className="inline-note success">{notice}</p>}
    {overdue.length>0&&<section className="roster-overdue" aria-label="Overdue active duties">
      <div><strong>Overdue active duties · {overdue.length}</strong>
        <p>These shifts still have an active duty record and can block the guard’s next activation.</p></div>
      <ul>{overdue.map(row=><li key={row.id}><button type="button" className="text-btn" onClick={()=>open(row.id)}>
        {names[row.guard_id]??short(row.guard_id)} · {row.post??'Post unavailable'} · ended {display(row.ended_at)}
      </button></li>)}</ul>
    </section>}
    <Card title="Shift roster" subtitle="Africa/Harare · UTC+02:00"
      action={<Button variant="primary" onClick={()=>{setDetail('');edit({type:'create'});}}
        disabled={roster.state==='error'}>Create shift</Button>}>
      <div className="roster-toolbar">
        <div className="roster-modes" role="group" aria-label="Roster view">
          {(['Week','Day','List'] as const).map(mode=><Button key={mode} aria-pressed={view===mode} onClick={()=>setView(mode)}>{mode}</Button>)}
        </div>
        <div className="roster-dates">
          <Button aria-label="Previous roster period" onClick={()=>setDate(shiftDay(date,view==='Day'?-1:-7))}>‹</Button>
          <label className="sr-only" htmlFor="roster-date">Roster date</label>
          <Input id="roster-date" type="date" value={date} onInput={event=>{if(event.currentTarget.value) setDate(event.currentTarget.value);}}/>
          <Button aria-label="Next roster period" onClick={()=>setDate(shiftDay(date,view==='Day'?1:7))}>›</Button>
          <Button onClick={()=>setDate(rosterDay(Date.now()))}>Today</Button>
        </div>
      </div>
      <div className="roster-filters">
        <label>Roster site<Select value={activeSite} onChange={event=>onSiteChange(event.target.value)}>
          {sites.map(site=><option key={site.id} value={site.id}>{site.name}</option>)}
        </Select></label>
        <label>Security post<Select value={post} onChange={event=>setPost(event.target.value)}>
          <option value="">All posts</option>
          {postRows.map(row=><option key={row.id} value={row.id}>{row.name}{row.is_active?'':' · Inactive'}</option>)}
        </Select></label>
        <label>Guard<Select value={effectiveGuard} onChange={event=>setGuard(event.target.value)}>
          <option value="">All guards</option>
          {guardIds.map(id=><option key={id} value={id}>{names[id]??short(id)}</option>)}
        </Select></label>
        <label>Status<Select value={status} onChange={event=>setStatus(event.target.value)}>
          <option value="">All statuses</option>
          {rosterStates.map(state=><option key={state}>{state}</option>)}
        </Select></label>
      </div>
      {posts.state==='error'&&<p role="alert" className="inline-note error">Post filters unavailable. <Button onClick={refresh}>Retry</Button></p>}
      {roster.state==='loading'&&<p role="status" className="empty">Loading roster…</p>}
      {roster.state==='error'&&<p role="alert" className="inline-note error">Roster unavailable. {rosterError(roster.error)} <Button onClick={refresh}>Retry</Button></p>}
      {roster.state==='ready'&&<>
        <p className="roster-period">{dayLabel(window.dates[0])}{window.dates.length>1?' – '+dayLabel(window.dates[6]):''}
          <span>{rows.length} {rows.length===1?'shift':'shifts'}</span></p>
        {view==='Week'&&<div className="roster-week" aria-label="Weekly shift grid">{window.dates.map(day=>{
          const dayShifts=rows.filter(row=>occursOnDay(row,day));
          return <section key={day} className={day===rosterDay(now)?'roster-today':''}>
            <h3>{dayLabel(day)}</h3>
            {dayShifts.length?dayShifts.map(row=>rosterCard(row,day)):<p>No shifts</p>}
          </section>;
        })}</div>}
        {view==='Day'&&<div className="roster-daily">{rows.length?rows.map(row=>rosterCard(row,date)):<p className="empty">No shifts match this day and filters.</p>}</div>}
        {view==='List'&&<Table name="Detailed shift list"
          heads={['Guard / post','Planned start','Planned end','Confirmed check-in','Confirmed checkout','Status']}
          rows={rows.map(row=>({id:row.id,cells:[
            <><button type="button" className="text-btn record-link" onClick={()=>open(row.id)}>{names[row.guard_id]??short(row.guard_id)}</button>
              <span className="sub">{row.post??'Post unavailable'}{row.shift_kind?' · '+row.shift_kind:''}</span></>,
            display(row.scheduled_start_at),display(row.scheduled_end_at),display(row.checked_in_at),
            display(row.checked_out_at),<Badge value={rosterState(row,now)}/>,
          ]}))}/>}
      </>}
    </Card>
    <Card title="Post coverage" subtitle="Staffing targets, roster bookings and recorded attendance by interval">
      {coverage.state==='loading'&&<p role="status" className="empty">Loading coverage…</p>}
      {coverage.state==='error'&&<p role="alert" className="inline-note error">Coverage unavailable. {rosterError(coverage.error)} <Button onClick={refresh}>Retry</Button></p>}
      {coverage.state==='ready'&&!activeCoverage&&<p className="empty">No active post coverage in this scope.</p>}
      {activeCoverage&&<>
        <div className="roster-coverage-toolbar">
          <label>Coverage interval<Select value={selectorKey(activeCoverage)} onChange={event=>setCoverageId(event.target.value)}>
            {coverageRows.map(row=><option value={selectorKey(row)} key={selectorKey(row)}>
              {row.post_name} · {display(row.start_at)} – {display(row.end_at)}
            </option>)}
          </Select></label>
          {admin&&<div className="roster-modes">
            <Button onClick={()=>{setDetail('');edit({type:'capacity',row:activeCoverage});}}>Configure capacity</Button>
            <Button onClick={()=>{setDetail('');edit({type:'staffing',row:activeCoverage});}}>
              {activeCoverage.requirement_id?'Edit staffing requirement':'Add staffing requirement'}</Button>
          </div>}
        </div>
        <div className="roster-coverage-metrics"><Metrics items={[
          {title:'Booking capacity',value:coverageValue(activeCoverage,'booking_capacity'),note:'Maximum simultaneous bookings',icon:'sites'},
          {title:'Required staffing',value:coverageValue(activeCoverage,'required_staffing'),note:'Configured target',icon:'guards'},
          {title:'Scheduled staffing',value:coverageValue(activeCoverage,'scheduled_personnel'),note:'Roster bookings',icon:'shifts'},
          {title:'Confirmed attendance',value:coverageValue(activeCoverage,'confirmed_attendance'),note:'Recorded attendance for this interval',icon:'clock'},
          {title:'Planned coverage gap',value:coverageValue(activeCoverage,'planned_gap'),note:'Required staff minus booked staff',icon:'warning'},
          {title:'Actual attendance gap',value:coverageValue(activeCoverage,'actual_attendance_gap'),note:'Required staff minus confirmed attendance',icon:'warning'},
        ]}/></div>
        <div className="roster-coverage-notes">
          {!activeCoverage.requirements_configured&&<p>Staffing requirements are unavailable for this interval.</p>}
          {activeCoverage.booking_capacity===null&&<p>Booking capacity has not been configured for this post.</p>}
          {activeCoverage.legacy_unmapped&&<p>Unmapped legacy shifts make post staffing and gaps unavailable.</p>}
          {!activeCoverage.actual_attendance_available&&<p>Confirmed attendance is unavailable for this interval.</p>}
        </div>
      </>}
    </Card>
    {detail&&!editor&&<Dialog title="Shift details" onClose={()=>setDetail('')}>
      {selected.state==='loading'&&<p role="status">Loading shift details…</p>}
      {selected.state==='error'&&<p role="alert" className="error">{rosterError(selected.error)} <Button onClick={refresh}>Retry</Button></p>}
      {selected.state==='ready'&&!shift&&<p>Shift details are unavailable.</p>}
      {shift&&<ShiftDetail shift={shift} site={selectedSite.name} name={names[shift.guard_id]??short(shift.guard_id)}
        state={rosterState(shift,now)} actions={rosterActions(shift,now,protectedDetail)}
        protectedIncoming={protectedDetail} successor={successor.state==='ready'?successor.value:null}
        successorName={successor.state==='ready'&&successor.value?names[successor.value.guard_id]??short(successor.value.guard_id):''}
        reconciliationActor={shift.reconciliation?names[shift.reconciliation.actor_id]??shift.reconciliation.actor_id:null}
        onOpenSuccessor={open} onEdit={()=>edit({type:'edit',shift})} onCancel={()=>edit({type:'cancel',shift})}
        onReconcile={admin&&shift.can_reconcile?()=>edit({type:'reconcile',shift}):undefined}/>}
    </Dialog>}
    {editor?.type==='create'&&<ShiftEditor {...editorProps} initialSiteId={activeSite} sites={sites} names={names} protectedIncoming={isProtected}/>}
    {editor?.type==='edit'&&<ShiftEditor {...editorProps} shift={editor.shift} initialSiteId={activeSite} sites={sites} names={names} protectedIncoming={isProtected}/>}
    {editor?.type==='cancel'&&<CancelShiftEditor {...editorProps} shift={editor.shift} protectedIncoming={isProtected}/>}
    {editor?.type==='reconcile'&&admin&&<ReconcileDutyEditor {...editorProps} shift={editor.shift}/>}
    {editor&&(editor.type==='staffing'||editor.type==='capacity')&&admin&&
      <CoverageEditor {...editorProps} row={editor.row} mode={editor.type} window={window} siteId={activeSite}/>}
  </div>;
}

function ShiftDetail({shift,site,name,state,actions,protectedIncoming,successor,successorName,onOpenSuccessor,onEdit,onCancel,
  reconciliationActor,onReconcile}:{
  shift:RosterShift;site:string;name:string;state:string;actions:{edit:boolean;cancel:boolean};protectedIncoming:boolean;
  successor:RosterShift|null;successorName:string;onOpenSuccessor:(id:string)=>void;onEdit:()=>void;onCancel:()=>void;
  reconciliationActor:string|null;onReconcile?:()=>void;
}) {
  return <>
    <p><strong>{name}</strong> · {site} · {shift.post??'Post unavailable'} <Badge value={state}/></p>
    <dl className="roster-detail-times">
      <div><dt>Planned start</dt><dd>{display(shift.scheduled_start_at)}</dd></div>
      <div><dt>Planned end</dt><dd>{display(shift.scheduled_end_at)}</dd></div>
      <div><dt>Confirmed check-in</dt><dd>{display(shift.checked_in_at)}</dd></div>
      <div><dt>Confirmed checkout</dt><dd>{shift.reconciliation&&!shift.checked_out_at?'Unknown · administratively reconciled':display(shift.checked_out_at)}</dd></div>
      {!shift.scheduled_start_at&&<><div><dt>Legacy window start</dt><dd>{display(shift.started_at)}</dd></div>
        <div><dt>Legacy window end</dt><dd>{display(shift.ended_at)}</dd></div></>}
    </dl>
    {shift.cancellation_reason&&<p>Cancellation reason: {shift.cancellation_reason}</p>}
    <p><strong>Successor shift</strong> · {successor?<button type="button" className="text-btn" onClick={()=>onOpenSuccessor(successor.id)}>
      {successorName} · {display(successor.started_at)}</button>:shift.successor_shift_id?'Configured · details unavailable':'No successor assigned'}</p>
    {(shift.status==='active'||Boolean(shift.checked_in_at))&&<p>The successor commitment is frozen.</p>}
    {protectedIncoming&&<p>This shift is protected by a successor commitment or pending handover.</p>}
    {state==='Overdue active duty'&&<p className="error">This shift blocks the next activation until the guard completes End Duty or an administrator reconciles it.</p>}
    {shift.reconciliation&&<section aria-label="Duty reconciliation history">
      <h3>Duty reconciliation history</h3>
      <p><strong>Administratively reconciled</strong> · {display(shift.reconciliation.reconciled_at)} · {reconciliationActor}</p>
      <p className="record-copy">{shift.reconciliation.reason}</p>
      {shift.reconciliation.late_checkout_received_at&&<p>Guard checkout evidence received · {display(shift.reconciliation.late_checkout_received_at)}</p>}
    </section>}
    <div className="modal-actions">
      {actions.edit&&<Button variant="primary" onClick={onEdit}>Edit assignment</Button>}
      {actions.cancel&&<Button onClick={onCancel}>Cancel assignment</Button>}
      {onReconcile&&<Button variant="primary" onClick={onReconcile}>Reconcile overdue duty</Button>}
    </div>
  </>;
}
