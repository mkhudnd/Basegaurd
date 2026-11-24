import {useEffect,useRef,type ComponentPropsWithoutRef,type ReactNode} from 'react';

export const navigation = [
  ['overview','Overview','Operations overview','A clear view of your security operations today.'],
  ['incidents','Incidents','Incident management','Review reports received from your permitted sites.'],
  ['occurrence','Occurrence Book','Digital occurrence book','Search and print records received from the field.'],
  ['guards','Guards','Guards','See guard references from authorized shift records.'],
  ['shifts','Shifts','Shifts & coverage','See scheduled assignments and confirmed check-ins.'],
  ['handovers','Handovers','Shift handovers','Review submitted handovers and incoming guard acknowledgement.'],
  ['sites','Sites','Sites & assignments','View your permitted sites and their guard assignments.'],
  ['live','Live Operations','Live operations','View authorized sites and urgent incident indicators.'],
  ['analytics','Analytics','Operational analytics','Track incident activity for the selected site scope.'],
  ['reports','Reports','Reports','Open available operational reports.'],
  ['settings','Settings','Account & settings','View your workspace account and access.'],
] as const;
export type Page = typeof navigation[number][0];
type IconName = Page|'menu'|'refresh'|'shield'|'arrow'|'close'|'clock'|'warning'|'logout';

const paths:Record<IconName,string> = {
  overview:'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8 16v-3m4 3V8m4 8V5',
  incidents:'M5 21V4m0 1h14l-4 5 4 5H5',
  occurrence:'M5 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2zM9 7h6m-6 5h6m-6 5h4',
  guards:'M15 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM5 21v-3a7 7 0 0 1 14 0v3',
  handovers:'M3 7h17l-4-4m4 4-4 4M21 17H4l4-4m-4 4 4 4',
  sites:'M12 22s8-7 8-13A8 8 0 0 0 4 9c0 6 8 13 8 13Z M14.5 9a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z',
  analytics:'M3 3v18h18M7 16l4-6 4 3 6-8',
  settings:'m9 3-1 3-3 1-2 3 2 2-1 3 3 2 2 4h4l1-3 3-1 3-3-2-3 1-3-3-2-2-3Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  shifts:'M4 7h16v14H4zM4 11h16M8 3v5m8-5v5m-7 7h2m2 0h2',
  live:'M2 12h5l3-7 4 14 3-7h5',
  reports:'M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6',
  menu:'M4 6h16M4 12h16M4 18h16',
  refresh:'M20 7v5h-5M4 17v-5h5m10.5-1A8 8 0 0 0 6 6m-1.5 7A8 8 0 0 0 18 18',
  shield:'M12 2 3 6v5c0 5 3 8 9 11 6-3 9-6 9-11V6zM9 12l2 2 4-5',
  arrow:'M5 12h14m-6-6 6 6-6 6',
  close:'m6 6 12 12M18 6 6 18',
  clock:'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM12 6v6l4 2',
  warning:'M12 3 2 21h20zM12 9v5m0 3h.01',
  logout:'M10 4H4v16h6m-1-8h12m-4-4 4 4-4 4',
};

export function Icon({name}:{name:IconName}) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}

export const label = (s:string) => s.replace(/_/g,' ').replace(/^./,c=>c.toUpperCase());
export function Button({variant='default',className='',...props}:ComponentPropsWithoutRef<'button'>&{variant?:'default'|'primary'}) {
  return <button type="button" {...props} className={['btn',variant==='primary'?'primary':'',className].filter(Boolean).join(' ')}/>;
}
export function Input({className='',...props}:ComponentPropsWithoutRef<'input'>) {
  return <input {...props} className={('field '+className).trim()}/>;
}
export function Select(props:ComponentPropsWithoutRef<'select'>) {
  return <select {...props}/>;
}

export function Badge({value}:{value:string}) {
  const tone = /critical|high|missed|needs review|coverage gap/i.test(value) ? 'red'
    : /pending|medium|scheduled|reported|in progress/i.test(value) ? 'amber'
    : /on duty|confirmed|acknowledged|resolved|covered|received/i.test(value) ? 'green' : 'gray';
  return <span className={'badge '+tone}>{label(value)}</span>;
}
export function Card({title,subtitle,action,children,className=''}:{title:string;subtitle?:string;action?:ReactNode;children:ReactNode;className?:string}) {
  return <section className={'card '+className}><div className="card-head"><div><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div>{action}</div>{children}</section>;
}
export function Metrics({items}:{items:{title:string;value:number|string|undefined;note:string;icon:IconName}[]}) {
  return <div className="metrics" aria-label="Key metrics">{items.map(m=><div className="metric" key={m.title}>
    <div className="metric-top">{m.title}<span className="metric-icon"><Icon name={m.icon}/></span></div>
    <div className="metric-value">{m.value??<span aria-label="Data unavailable">—</span>}</div><small>{m.note}</small>
  </div>)}</div>;
}
export function Table({heads,rows,name}:{heads:string[];rows:{id:string;cells:ReactNode[]}[];name:string}) {
  if (!rows.length) return <p className="empty">No records match this view.</p>;
  return <div className="table-wrap" tabIndex={0} role="region" aria-label={name}><table className="table">
    <thead><tr>{heads.map(h=><th key={h} scope="col">{h}</th>)}</tr></thead>
    <tbody>{rows.map(r=><tr key={r.id}>{r.cells.map((c,i)=><td key={i}>{c}</td>)}</tr>)}</tbody>
  </table></div>;
}
export function Dialog({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const dialog=ref.current;dialog?.showModal();return ()=>dialog?.close();},[]);
  return <dialog ref={ref} className="modal" aria-labelledby="detail-title" onCancel={e=>{e.preventDefault();onClose();}}>
    <div className="detail-heading"><h2 id="detail-title">{title}</h2><button className="btn icon-only" onClick={onClose} aria-label="Close details"><Icon name="close"/></button></div>{children}
  </dialog>;
}
