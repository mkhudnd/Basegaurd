type ShiftWindow={status:string;started_at:string;ended_at:string|null;checked_in_at?:string|null};
export function missedCheckIn(s:ShiftWindow,now=Date.now()){
 return s.status==='scheduled' && !s.checked_in_at && Date.parse(s.started_at)<=now &&
   (s.ended_at?Date.parse(s.ended_at)>now:
     new Date(Date.parse(s.started_at)+7200000).toISOString().slice(0,10)===new Date(now+7200000).toISOString().slice(0,10));
}
