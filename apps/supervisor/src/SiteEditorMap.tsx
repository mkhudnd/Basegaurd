import {useEffect, useRef, useState} from 'react';
import type {Map as MapInstance, GeoJSONSource} from 'maplibre-gl';
import type {Feature, FeatureCollection, Geometry} from 'geojson';
import type {Position, SecurityPost, SiteBoundary} from './site-geography';

const sourceId = 'site-editor-geography';
const mercatorLimit = 85.051129;
const mapPosition = ([lon, lat]: Position): Position => [lon, Math.max(-mercatorLimit, Math.min(mercatorLimit, lat))];

type Props = {
  center: Position | null;
  vertices: Position[];
  boundary: SiteBoundary | null;
  posts: SecurityPost[];
  postDraft?: Position | null;
  vertexIndex?: number | null;
  onPick?: (position: Position) => void;
};

function features(props: Props): FeatureCollection {
  const records: Feature[] = [];
  const add = (kind: string, geometry: Geometry) => records.push({type: 'Feature', properties: {kind}, geometry});
  const point = (kind: string, pos: Position) => add(kind, {type: 'Point', coordinates: mapPosition(pos)});
  if (props.boundary) add('boundary', {type: 'Polygon', coordinates: [props.boundary.coordinates[0].map(mapPosition)]});
  else if (props.vertices.length > 1) add('guide', {type: 'LineString', coordinates: props.vertices.map(mapPosition)});
  for (const [index, vertex] of props.vertices.entries()) point(index === props.vertexIndex ? 'selected' : 'vertex', vertex);
  if (props.center) point('center', props.center);
  for (const post of props.posts) if (post.location) point(post.is_active ? 'post' : 'inactive', post.location.coordinates);
  if (props.postDraft) point('draft', props.postDraft);
  return {type: 'FeatureCollection', features: records};
}

export function SiteEditorMap(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<MapInstance | null>(null);
  const current = useRef(props);
  const fitted = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    current.current = props;
    const source = map.current?.getSource(sourceId) as GeoJSONSource | undefined;
    source?.setData(features(props));
    if (source && !fitted.current) fit();
    if (map.current) map.current.getCanvas().style.cursor = props.onPick ? 'crosshair' : '';
  }, [props]);

  function fit() {
    const {center, boundary, vertices, posts, postDraft} = current.current;
    const positions = [
      ...(center ? [center] : []), ...(boundary?.coordinates[0] ?? vertices),
      ...posts.flatMap(post => post.location ? [post.location.coordinates] : []),
      ...(postDraft ? [postDraft] : []),
    ].map(mapPosition);
    if (!positions.length || !map.current) return;
    fitted.current = true;
    const x = positions.map(p => p[0]), y = positions.map(p => p[1]);
    map.current.fitBounds([Math.min(...x), Math.min(...y), Math.max(...x), Math.max(...y)],
      {padding: 42, maxZoom: 17, duration: 0});
  }

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let stopped = false;
    fitted.current = false;
    void import('maplibre-gl').then(({Map, NavigationControl}) => {
      if (stopped) return;
      const instance = new Map({
        container, style: import.meta.env.VITE_OPERATIONS_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/positron',
        center: [30, -19], zoom: 6, renderWorldCopies: false, dragRotate: false,
        attributionControl: {compact: true},
      });
      map.current = instance;
      instance.addControl(new NavigationControl({showCompass: false}));
      instance.on('error', () => { if (!stopped) setState('error'); });
      instance.on('click', event => current.current.onPick?.([event.lngLat.wrap().lng, event.lngLat.lat]));
      instance.once('load', () => {
        if (stopped) return;
        instance.addSource(sourceId, {type: 'geojson', data: features(current.current)});
        instance.addLayer({id: 'site-editor-fill', type: 'fill', source: sourceId,
          filter: ['==', ['get', 'kind'], 'boundary'], paint: {'fill-color': '#16A34A', 'fill-opacity': 0.2}});
        instance.addLayer({id: 'site-editor-line', type: 'line', source: sourceId,
          filter: ['in', ['get', 'kind'], ['literal', ['guide', 'boundary']]],
          paint: {'line-color': '#174E42', 'line-width': 3}});
        instance.addLayer({id: 'site-editor-points', type: 'circle', source: sourceId,
          filter: ['==', ['geometry-type'], 'Point'],
          paint: {'circle-radius': 7, 'circle-stroke-width': 2, 'circle-stroke-color': '#fff',
            'circle-color': ['match', ['get', 'kind'], 'post', '#2563a2', 'inactive', '#68776e',
              'draft', '#9a560c', 'selected', '#9a560c', 'vertex', '#16A34A', '#174E42']}});
        instance.getCanvas().style.cursor = current.current.onPick ? 'crosshair' : '';
        fit();
        setState('ready');
      });
    }).catch(() => { if (!stopped) setState('error'); });
    return () => { stopped = true; map.current?.remove(); map.current = null; };
  }, [attempt]);

  return <div className="site-map-shell">
    <div ref={host} className="site-map-canvas" aria-label="Site geography map" />
    <div className="site-map-meta">
      <span>Site center and perimeter in green · Active posts in blue · Inactive posts in grey</span>
      <button type="button" className="text-btn" disabled={state === 'loading'} onClick={fit}>Fit saved and draft points</button>
    </div>
    {state === 'loading' && <p className="inline-note" role="status">Loading the basemap…</p>}
    {state === 'error' && <p className="inline-note" role="alert">Some map content could not load. Coordinate fields remain available. <button type="button" className="text-btn" onClick={() => { setState('loading'); setAttempt(n => n + 1); }}>Retry map</button></p>}
  </div>;
}
