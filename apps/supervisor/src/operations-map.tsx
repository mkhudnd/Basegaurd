import {useEffect,useMemo,useRef,useState} from 'react';
import type {Map as MapInstance,Marker as MapMarker} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {Card,Icon} from './ui';
import type {Site} from './service';

type Status='covered'|'gap'|'incident'|'unknown';
const legend:Record<Status,string>={
  covered:'Confirmed coverage',gap:'Confirmed coverage gap',incident:'Active urgent incident',unknown:'Coverage unknown',
};
const styleUrl=import.meta.env.VITE_OPERATIONS_MAP_STYLE_URL||'https://tiles.openfreemap.org/styles/positron';
type SitePoint={site:Site; coordinates:[number,number]; status:Status};

function point(site:Site, incidentSites?:ReadonlySet<string>, coverage?:ReadonlyMap<string,'covered'|'gap'>):SitePoint[] {
  const {latitude,longitude}=site;
  if(typeof latitude!=='number'||typeof longitude!=='number'||!Number.isFinite(latitude)||
    !Number.isFinite(longitude)||Math.abs(latitude)>85.051129||Math.abs(longitude)>180)return [];
  // A staffing target and confirmed post coverage are required to set covered/gap.
  const status=incidentSites?.has(site.id)?'incident':coverage?.get(site.id)??'unknown';
  return [{site,coordinates:[longitude,latitude],status}];
}

export function OperationsMap({sites,incidentSites,onSelectSite}:{
  sites:Site[];incidentSites?:ReadonlySet<string>;onSelectSite:(id:string)=>void;
}) {
  const points=useMemo(()=>sites.flatMap(site=>point(site,incidentSites)),[sites,incidentSites]);
  const [selectedId,setSelectedId]=useState('');
  const selected=points.find(p=>p.site.id===selectedId);
  return <Card title="Operations map" subtitle="Authorized security sites" className="operations-map">
    {points.length?<MapCanvas points={points} onMarkerSelect={setSelectedId}/>:<div className="map-unavailable">
      <span className="site-icon"><Icon name="sites"/></span><strong>Site locations unavailable</strong>
      <p>{sites.length?'The selected sites have no valid coordinates on record.':'No authorized sites are available to display.'}</p>
    </div>}
    {selected&&<div className="map-selection">
      <div><strong>{selected.site.name}</strong><span className="sub">{selected.site.code} · {legend[selected.status]}</span></div>
      {sites.length>1&&<button className="btn" onClick={()=>onSelectSite(selected.site.id)}>Filter dashboard to site</button>}
      <button className="btn icon-only" onClick={()=>setSelectedId('')} aria-label="Close site details"><Icon name="close"/></button>
    </div>}
    <div className="map-footer"><ul className="map-legend" aria-label="Map legend">
      {Object.entries(legend).map(([key,label])=><li key={key}><span className={'map-dot '+key}/>{label}</li>)}
    </ul>{points.length>0&&points.length<sites.length&&<small>{sites.length-points.length} sites have no coordinates.</small>}</div>
  </Card>;
}

function MapCanvas({points,onMarkerSelect}:{points:SitePoint[];onMarkerSelect:(id:string)=>void}) {
  const container=useRef<HTMLDivElement>(null);
  const [state,setState]=useState<'loading'|'ready'|'error'>('loading');
  const [attempt,setAttempt]=useState(0);

  useEffect(()=>{
    const node=container.current;
    if(!node)return;
    let map:MapInstance|undefined;
    let stopped=false;
    const markers:MapMarker[]=[];
    void import('maplibre-gl').then(({Map,Marker,LngLatBounds,NavigationControl,FullscreenControl})=>{
      if(stopped)return;
      const bounds=new LngLatBounds();
      for(const {coordinates} of points)bounds.extend(coordinates);
      map=new Map({container:node,style:styleUrl,bounds,fitBoundsOptions:{padding:56,maxZoom:15},
        cooperativeGestures:true,renderWorldCopies:false,attributionControl:{compact:false}});
      map.addControl(new NavigationControl({showCompass:false}),'top-right');
      map.addControl(new FullscreenControl({pseudo:true}),'top-right');
      map.once('load',()=>{if(!stopped)setState('ready');});
      map.on('error',()=>{if(!stopped)setState('error');});
      for(const {site,coordinates,status} of points){
        const button=document.createElement('button');
        button.type='button';
        button.className='map-marker '+status;
        button.setAttribute('aria-label',site.name+' · '+legend[status]);
        button.title=site.name+' · '+legend[status];
        button.addEventListener('click',()=>onMarkerSelect(site.id));
        markers.push(new Marker({element:button}).setLngLat(coordinates).addTo(map));
      }
    }).catch(()=>{if(!stopped)setState('error');});
    return ()=>{stopped=true;markers.forEach(marker=>marker.remove());map?.remove();};
  },[attempt,points,onMarkerSelect]);

  return <div className="map-frame">
    <div ref={container} className="map-viewport" aria-label="Interactive operations map"/>
    {state==='loading'&&<p role="status" className="map-message">Loading map…</p>}
    {state==='error'&&<div role="alert" className="map-message">Some map content could not load. <button className="btn" onClick={()=>{setState('loading');setAttempt(a=>a+1);}}>Retry map</button></div>}
  </div>;
}
