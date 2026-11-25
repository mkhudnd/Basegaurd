import {Badge,Button,Card,Table} from './ui';
import {rosterError,rosterTime} from './roster-domain';
import {getOperationsSchedule} from './roster-service';
import {useRosterResource} from './RosterEditors';
import type {Site} from './service';

const states={overdue:'Overdue active duty',missed:'Missed check-in',
  awaiting:'Awaiting check-in',upcoming:'Upcoming'} as const;

export function OperationsSchedule({sites,version,names,onOpen,onRefresh}:{
  sites:Site[];version:number;names:Record<string,string>;
  onOpen:(siteId:string,shiftId:string)=>void;onRefresh:()=>void;
}) {
  return <Card className="lower" title="Scheduling and coverage"
    subtitle="Today in Africa/Harare · confirmed check-ins reflect attendance records">
    <div className="sections">{sites.map(site=><SiteSchedule key={site.id} site={site}
      version={version} names={names} onOpen={onOpen} onRefresh={onRefresh}/>)}</div>
  </Card>;
}

function SiteSchedule({site,version,names,onOpen,onRefresh}:{
  site:Site;version:number;names:Record<string,string>;
  onOpen:(siteId:string,shiftId:string)=>void;onRefresh:()=>void;
}) {
  const schedule=useRosterResource(JSON.stringify([site.id,version]),signal=>getOperationsSchedule(site.id,signal));
  if (schedule.state==='loading') return <p role="status" className="empty">Loading {site.name} scheduling…</p>;
  if (schedule.state==='error') return <p role="alert" className="inline-note error">
    {site.name} scheduling is unavailable. {rosterError(schedule.error)} <Button onClick={onRefresh}>Retry</Button></p>;
  const row=schedule.value;
  const metrics=[
    ['Scheduled today',row.today_scheduled],['Confirmed check-ins today',row.confirmed_check_ins],
    ['Upcoming · 7-day roster',row.upcoming],['Awaiting check-in',row.awaiting],
    ['Missed check-ins today',row.missed],['Overdue active duties',row.overdue],
    ['Posts with documented planned gaps',row.planned_gap_posts],
    ['Posts with documented attendance gaps',row.attendance_gap_posts],
    ['Posts missing staffing requirements',row.unconfigured_posts],
    ['Posts with attendance unavailable',row.unknown_attendance_posts],
  ] as const;
  return <section className="operation-schedule-site" aria-label={site.name+' scheduling'}>
    <h3>{site.name}</h3>
    <dl className="roster-detail-times">{metrics.map(([title,count])=><div key={title}>
      <dt>{title}</dt><dd>{count}</dd>
    </div>)}</dl>
    {row.rows.length?<Table name={site.name+' roster activity'} heads={['Status','Guard / post','Shift start','Action']}
      rows={row.rows.map(shift=>({id:shift.id,cells:[
        <Badge value={states[shift.state]}/>,
        <><strong>{names[shift.guard_id]??'Guard '+shift.guard_id.slice(-8).toUpperCase()}</strong>
        <span className="sub">{shift.post??'Post unavailable'}</span>
        <span className="sub operation-schedule-mobile-time">{rosterTime(shift.planned_start)}</span></>,
        rosterTime(shift.planned_start),
        <button className="text-btn" aria-label="Open roster record" onClick={()=>onOpen(site.id,shift.id)}>
          <span className="operation-schedule-full-action">Open roster record</span>
          <span className="operation-schedule-compact-action">Open</span>
        </button>,
      ]}))}/>:
      <p className="empty">No upcoming assignments, overdue duties, or check-ins that need review in this view.</p>}
    {row.upcoming+row.awaiting+row.missed+row.overdue>row.rows.length&&
      <p className="inline-note">Showing the first {row.rows.length} records. Use Shifts for the full roster.</p>}
  </section>;
}
