/** Pure calculations for the server-received supervisor dashboard. */
export type DashboardIncident = {status:string;received_at:string};
export type DashboardShift = {
  id:string;guard_id:string;status:string;ended_at:string|null;
  presence_status:'on_duty'|'on_break'|null;
};
export function countSupervisorOverview<TShift extends DashboardShift>(
  incidents:DashboardIncident[],shifts:TShift[],nowISO:string,
){
  const now=new Date(nowISO).getTime();
  const active=shifts.filter(s=>s.status==='active' &&
    (s.ended_at===null || new Date(s.ended_at).getTime()>now));
  const onDuty=new Set(active.filter(s=>s.presence_status==='on_duty').map(s=>s.guard_id)).size;
  const onBreak=new Set(active.filter(s=>s.presence_status==='on_break').map(s=>s.guard_id)).size;
  return {
    onDuty,onBreak,
    activeShifts:active,
    awaiting:incidents.filter(i=>i.status==='reported').length,
    openCases:incidents.filter(i=>!['closed','resolved'].includes(i.status)).length,
  };
}
