/** Duty presence is server-confirmed. A cached shift alone cannot verify a break. */
export type DutyPresence = 'on_duty' | 'on_break';

export const dutyPresenceLabel = (value: DutyPresence | null): string => {
  if (value === 'on_break') return 'On Break';
  if (value === 'on_duty') return 'On Duty';
  return 'Status Unavailable';
};

export function canChangeDutyPresence(args: {
  shiftId: string | null | undefined;
  isOnline: boolean;
  isCachedDuty: boolean;
  isBusy: boolean;
}): boolean {
  return Boolean(args.shiftId && args.isOnline && !args.isCachedDuty && !args.isBusy);
}

/** Guards always end shifts through a verified handover, never a status toggle. */
export const OFF_DUTY_REQUIRES_HANDOVER = true;

/** Display duration only when the server supplies the break-start timestamp. */
export function breakDurationLabel(startedAt:string|null|undefined,now=Date.now()):string|null {
 if(!startedAt)return null;
 const started=Date.parse(startedAt);
 if(!Number.isFinite(started)||started>now+60_000)return null;
 const minutes=Math.max(0,Math.floor((now-started)/60_000));
 if(minutes<1)return 'Less than 1 min';
 if(minutes<60)return `${minutes} min`;
 const hours=Math.floor(minutes/60);
 return minutes%60 ? `${hours} h ${minutes%60} min` : `${hours} h`;
}
