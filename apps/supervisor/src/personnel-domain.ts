export type PersonnelSort = 'name_asc'|'name_desc'|'recent_duty_desc'|'created_desc';

export type PersonnelAssignment = {
  site_id:string; site_name:string; role_at_site:string;
  valid_from:string; valid_to:string|null; status:'active'|'scheduled'|'ended';
};

export type PersonnelRecord = {
  id:string; display_name:string; role:string; account_active:boolean; created_at:string;
  duty_status:'on_duty'|'on_break'|'scheduled'|'off_duty'|'unavailable';
  current_site_id:string|null; current_post:string|null; current_shift_started_at:string|null;
  last_check_in_at:string|null; site_ids:string[]; assignments:PersonnelAssignment[];
};

export type PersonnelMetrics = {
  total:number; active_accounts:number; on_duty:number; active_assignments:number;
};

export type PersonnelPage = {rows:PersonnelRecord[];count:number;metrics:PersonnelMetrics};

export function safePersonnelSearch(value:string) {
  return value.replace(/[(),.%]/g,' ').replace(/\s+/g,' ').trim().slice(0,120);
}

export function personnelInitials(name:string) {
  return name.trim().split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join('').toUpperCase()||'?';
}

export function displayDutyStatus(status:string) {
  return status.replace(/_/g,' ').replace(/^./,letter=>letter.toUpperCase());
}

function isRecord(value:unknown):value is Record<string,unknown> {
  return Boolean(value&&typeof value==='object'&&!Array.isArray(value));
}

export function validatePersonnelPage(value:unknown,allowedSiteIds:Set<string>,pageSize:number):PersonnelPage {
  if(!isRecord(value)||!Array.isArray(value.rows)||!isRecord(value.metrics)||
    typeof value.count!=='number'||value.count<0||value.rows.length>pageSize)throw new Error('Invalid personnel directory response.');
  const rows=value.rows as PersonnelRecord[];
  for(const row of rows){
    if(!isRecord(row)||typeof row.id!=='string'||typeof row.display_name!=='string'||!Array.isArray(row.site_ids)||!Array.isArray(row.assignments))
      throw new Error('Invalid personnel directory response.');
    if(row.site_ids.some(siteId=>typeof siteId!=='string'||!allowedSiteIds.has(siteId)))
      throw new Error('Personnel response included an unauthorized site.');
  }
  const metrics=value.metrics as Record<string,unknown>;
  for(const key of ['total','active_accounts','on_duty','active_assignments'])
    if(typeof metrics[key]!=='number'||Number(metrics[key])<0)throw new Error('Invalid personnel metrics response.');
  return value as unknown as PersonnelPage;
}

export function personnelCapabilities() {
  return {
    invite:true,
    editProfile:false,
    changeAccountStatus:false,
    changeAssignments:false,
    deletePersonnel:false,
  } as const;
}
