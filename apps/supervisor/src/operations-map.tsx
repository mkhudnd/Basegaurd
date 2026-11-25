import {useEffect, useMemo, useRef, useState} from 'react';
import type {GeoJSONSource, Map as MapInstance, Marker as MapMarker} from 'maplibre-gl';
import type {FeatureCollection, Polygon} from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import {Button, Card, Select} from './ui';
import {errorMessage, listManagedSites, listSecurityPosts, type Site} from './service';
import {geographicSites, visiblePositions, type MapLayers, type MapSite} from './operations-geography';
import type {Position, SecurityPost} from './site-geography';

const styleUrl = import.meta.env.VITE_OPERATIONS_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/positron';
const allLayers: MapLayers = {sites: true, boundaries: true, posts: true};
const sourceId = 'baseguard-site-perimeters';
const fillId = 'baseguard-perimeter-fill';
const layerLabels: Record<keyof MapLayers, string> = {sites: 'Site centers', boundaries: 'Perimeters', posts: 'Security posts'};
type Selection = {siteId: string; postId?: string};
type MapLoad = {scope: string; sites: MapSite[]; incomplete: boolean; error?: string};

export function OperationsMap({sites, incidentSites, version, onSelectSite, onOpenSite}: {
  sites: Site[];
  incidentSites?: ReadonlySet<string>;
  version: number;
  onSelectSite: (id: string) => void;
  onOpenSite: (id: string) => void;
}) {
  const selectedScope = useMemo(() => JSON.stringify(sites.map(site => site.id).sort()), [sites]);
  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState<MapLoad>();
  const [selection, setSelection] = useState<Selection>();
  const [layers, setLayers] = useState(allLayers);
  const scope = selectedScope + ':' + version + ':' + attempt;
  const result = load?.scope === scope ? load : undefined;

  useEffect(() => {
    const request = new AbortController();
    const ids = new Set<string>(JSON.parse(selectedScope));
    async function fetchGeography() {
      if (!ids.size) return {sites: [], incomplete: false};
      const managed = (await listManagedSites(request.signal)).filter(site => site.is_active && ids.has(site.id));
      const posts: SecurityPost[] = [];
      let incomplete = false;
      for (let start = 0; start < managed.length && !request.signal.aborted; start += 6) {
        const batch = await Promise.allSettled(managed.slice(start, start + 6)
          .map(site => listSecurityPosts(site.id, request.signal).then(rows => rows.filter(row => row.site_id === site.id))));
        for (const response of batch) {
          if (response.status === 'fulfilled') posts.push(...response.value);
          else incomplete = true;
        }
      }
      return {sites: geographicSites(ids, managed, posts), incomplete};
    }
    void fetchGeography().then(data => {
      if (!request.signal.aborted) setLoad({scope, ...data});
    }).catch(error => {
      if (!request.signal.aborted) setLoad({scope, sites: [], incomplete: false,
        error: errorMessage(error, 'Geographic records could not be loaded.')});
    });
    return () => request.abort();
  }, [scope, selectedScope]);

  const records = result?.sites;
  const selected = records?.find(site => site.id === selection?.siteId);
  const post = selected?.posts.find(row => row.id === selection?.postId);
  const hasGeometry = records?.some(site => visiblePositions(site, allLayers).length) ?? false;
  const hasVisibleGeometry = records?.some(site => visiblePositions(site, layers).length) ?? false;
  const unmapped = records?.filter(site => !visiblePositions(site, allLayers).length).length ?? 0;
  const retry = () => setAttempt(value => value + 1);

  return <Card title="Operations map" subtitle="Authorized active sites and configured security posts" className="operations-map">
    {!result && <p className="empty" role="status">Loading site geography…</p>}
    {result?.error && <p className="inline-note error" role="alert">Site geography unavailable. {result.error} <Button onClick={retry}>Retry geography</Button></p>}
    {result?.incomplete && <p className="inline-note" role="status">Some security posts could not be loaded. <Button onClick={retry}>Retry geography</Button></p>}
    {records?.length ? <div className="ops-map-toolbar">
      <label>Map site<Select value={selected?.id ?? ''} onChange={e => setSelection(e.target.value ? {siteId: e.target.value} : undefined)}>
        <option value="">All active sites in scope</option>
        {records.map(site => <option value={site.id} key={site.id}>{site.name}</option>)}
      </Select></label>
      <fieldset><legend>Show on map</legend>{Object.entries(layerLabels).map(([key, label]) => {
        const layer = key as keyof MapLayers;
        return <label key={layer}><input type="checkbox" checked={layers[layer]}
          onChange={event => setLayers({...layers, [layer]: event.target.checked})}/>{label}</label>;
      })}</fieldset>
      {selected && selected.posts.length > 0 && <label>Security post
        <Select value={post?.id ?? ''} onChange={event => setSelection({siteId:selected.id, postId:event.target.value || undefined})}>
          <option value="">Site details</option>
          {selected.posts.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
        </Select></label>}
    </div> : null}
    {records && !result?.error && !hasGeometry && <div className="map-unavailable">
      <strong>{records.length ? 'Site locations unavailable' : 'No authorized active sites'}</strong>
      <p>{records.length ? 'Configure a center, perimeter, or security-post location in Sites to see it here.' : 'There are no active sites in this map scope.'}</p>
    </div>}
    {hasGeometry && hasVisibleGeometry && records && <MapCanvas sites={records} incidentSites={incidentSites}
      layers={layers} selection={selection} onSelect={setSelection}/>}
    {hasGeometry && !hasVisibleGeometry && <p className="empty">No configured features are visible with these layer settings.</p>}
    {selected && <div className="map-selection ops-map-details" aria-label={post ? 'Post map details' : 'Site map details'}>
      <div>
        <strong>{post?.name ?? selected.name}</strong>
        <span className="sub">{post ? post.code + ' · ' + selected.name : selected.code + ' · Active site'}</span>
        {post ? <small>{post.outside_boundary === true ? 'Outside the configured perimeter' : post.location ? 'Configured post location' : 'Post location unavailable'}</small>
          : <small>{selected.center ? 'Center configured' : 'No center'} · {selected.boundary ? 'Perimeter configured' : 'No perimeter'}{incidentSites?.has(selected.id) ? ' · Active urgent incident' : ''}</small>}
      </div>
      <Button onClick={() => onOpenSite(selected.id)}>Open site workspace</Button>
      {records && records.length > 1 && <Button onClick={() => onSelectSite(selected.id)}>Filter dashboard to site</Button>}
      <Button onClick={() => setSelection(undefined)} aria-label="Close map details">Close</Button>
    </div>}
    {result && !result.error && <div className="map-footer">
      <ul className="map-legend" aria-label="Map legend">
        <li><span className="map-dot unknown"/>Site center</li>
        <li><span className="map-dot incident"/>Site with urgent incident</li>
        <li><span className="map-dot ops-boundary"/>Perimeter</li>
        <li><span className="map-dot ops-post"/>Security post</li>
      </ul>
      {unmapped > 0 && <small>{unmapped} active {unmapped === 1 ? 'site has' : 'sites have'} no mappable geography.</small>}
    </div>}
  </Card>;
}

function MapCanvas({sites, layers, incidentSites, selection, onSelect}: {
  sites: MapSite[]; layers: MapLayers; incidentSites?: ReadonlySet<string>;
  selection?: Selection; onSelect: (selection: Selection) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<MapInstance | null>(null);
  const markerType = useRef<typeof MapMarker | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [providerError, setProviderError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [mapGeneration, setMapGeneration] = useState(0);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let stopped = false;
    const timeout = window.setTimeout(() => { if (!stopped && !map.current?.getSource(sourceId)) setState('error'); }, 12000);
    void import('maplibre-gl').then(({Map, Marker, NavigationControl, FullscreenControl}) => {
      if (stopped) return;
      const instance = new Map({container, style: styleUrl, renderWorldCopies: false,
        cooperativeGestures: true, attributionControl: {compact: true}});
      map.current = instance;
      markerType.current = Marker;
      instance.addControl(new NavigationControl({showCompass: false}));
      instance.addControl(new FullscreenControl({pseudo: true}));
      instance.on('error', () => { if (!stopped) setProviderError(true); });
      instance.once('load', () => {
        if (stopped) return;
        instance.addSource(sourceId, {type: 'geojson', data: {type: 'FeatureCollection', features: []}});
        instance.addLayer({id: fillId, source: sourceId, type: 'fill',
          paint: {'fill-color': '#16A34A', 'fill-opacity': 0.18}});
        instance.addLayer({id: sourceId + '-outline', source: sourceId, type: 'line',
          paint: {'line-color': '#174E42', 'line-width': 2}});
        instance.on('click', fillId, event => {
          const id = event.features?.[0]?.properties.siteId;
          if (typeof id === 'string') onSelect({siteId: id});
        });
        instance.on('mouseenter', fillId, () => { instance.getCanvas().style.cursor = 'pointer'; });
        instance.on('mouseleave', fillId, () => { instance.getCanvas().style.cursor = ''; });
        window.clearTimeout(timeout);
        setState('ready');
        setMapGeneration(value => value + 1);
      });
    }).catch(() => { if (!stopped) setState('error'); });
    return () => {
      stopped = true;
      window.clearTimeout(timeout);
      map.current?.remove();
      map.current = null;
      markerType.current = null;
    };
  }, [retry, onSelect]);

  useEffect(() => {
    const instance = map.current;
    const Marker = markerType.current;
    const source = instance?.getSource(sourceId) as GeoJSONSource | undefined;
    if (!instance || !Marker || !source) return;
    const geometry: FeatureCollection<Polygon> = {type: 'FeatureCollection', features: []};
    const markers: MapMarker[] = [];
    const addMarker = (position: Position, name: string, tone: string, target: Selection) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'map-marker ' + tone;
      button.title = name;
      button.setAttribute('aria-label', name);
      button.addEventListener('click', () => onSelect(target));
      markers.push(new Marker({element: button}).setLngLat(position).addTo(instance));
    };
    for (const site of sites) {
      if (layers.sites && site.center) addMarker(site.center, site.name + ' site center', incidentSites?.has(site.id) ? 'incident' : 'unknown', {siteId: site.id});
      if (layers.boundaries && site.boundary) geometry.features.push({
        type: 'Feature', geometry: site.boundary, properties: {siteId: site.id},
      });
      if (layers.posts) for (const post of site.posts) {
        if (post.location) addMarker(post.location.coordinates, post.name + ' security post', 'ops-post', {siteId: site.id, postId: post.id});
      }
    }
    source.setData(geometry);
    return () => markers.forEach(marker => marker.remove());
  }, [sites, layers, incidentSites, mapGeneration, onSelect]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !instance.getSource(sourceId)) return;
    const site = sites.find(row => row.id === selection?.siteId);
    const post = site?.posts.find(row => row.id === selection?.postId);
    const specific = post?.location && layers.posts ? [post.location.coordinates] : site ? visiblePositions(site, layers) : [];
    const positions = specific.length ? specific : sites.flatMap(row => visiblePositions(row, layers));
    if (!positions.length) return;
    const bounds = positions.reduce<[number, number, number, number]>(([west, south, east, north], [lon, lat]) =>
      [Math.min(west, lon), Math.min(south, lat), Math.max(east, lon), Math.max(north, lat)],
    [Infinity, Infinity, -Infinity, -Infinity]);
    instance.fitBounds(bounds, {padding: 44, maxZoom: 16, duration: 0});
  }, [sites, layers, selection, mapGeneration]);

  return <div className="map-frame">
    <div ref={host} className="map-viewport" aria-label="Interactive operations map"/>
    {state === 'loading' && !providerError && <p role="status" className="map-message">Loading map…</p>}
    {(state === 'error' || providerError) && <div role="alert" className="map-message">
      Some map content could not load. Site details remain available above and below the map.{' '}
      <Button onClick={() => { setState('loading'); setProviderError(false); setRetry(value => value + 1); }}>Retry map</Button>
    </div>}
  </div>;
}
