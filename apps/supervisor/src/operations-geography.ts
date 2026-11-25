import {isPosition, type ManagedSite, type Position, type SecurityPost, type SiteBoundary} from './site-geography';

export type MapSite = {
  id: string; name: string; code: string;
  center: Position | null; boundary: SiteBoundary | null; posts: SecurityPost[];
};
export type MapLayers = {sites: boolean; boundaries: boolean; posts: boolean};

const canPlot = (point: unknown): point is Position => isPosition(point) && Math.abs(point[1]) <= 85.051129;

export function geographicSites(activeIds: ReadonlySet<string>, sites: ManagedSite[], posts: SecurityPost[]): MapSite[] {
  const bySite = new Map<string, SecurityPost[]>();
  for (const post of posts) {
    if (!post.is_active || !activeIds.has(post.site_id)) continue;
    const group = bySite.get(post.site_id) ?? [];
    group.push(post);
    bySite.set(post.site_id, group);
  }
  return sites.filter(site => site.is_active && activeIds.has(site.id)).map(site => {
    const center = site.center?.coordinates;
    const ring = site.boundary?.coordinates[0];
    return {
      id: site.id, name: site.name, code: site.code, center: canPlot(center) ? center : null,
      boundary: ring && ring.length >= 4 && ring.every(canPlot) ? site.boundary : null,
      posts: (bySite.get(site.id) ?? []).map(post =>
        canPlot(post.location?.coordinates) ? post : {...post, location: null}),
    };
  });
}

export function visiblePositions(site: MapSite, layers: MapLayers): Position[] {
  return [
    ...(layers.sites && site.center ? [site.center] : []),
    ...(layers.boundaries ? site.boundary?.coordinates[0] ?? [] : []),
    ...(layers.posts ? site.posts.flatMap(post => post.location ? [post.location.coordinates] : []) : []),
  ];
}
