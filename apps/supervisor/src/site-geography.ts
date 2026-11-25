export type Position = [longitude: number, latitude: number];
export type SitePoint = {type: 'Point'; coordinates: Position};
export type SiteBoundary = {type: 'Polygon'; coordinates: [Position[]]};

export type ManagedSite = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  revision: number;
  details: string | null;
  center: SitePoint | null;
  boundary: SiteBoundary | null;
  geography_revision: number;
  can_edit: boolean;
  can_manage_status: boolean;
};

export type SecurityPost = {
  id: string;
  site_id: string;
  code: string;
  name: string;
  is_active: boolean;
  location: SitePoint | null;
  revision: number;
  outside_boundary: boolean | null;
};

export function isPosition(value: unknown): value is Position {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite)
    && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
}

export function parsePosition(longitude: string, latitude: string): Position | null {
  if (!longitude.trim() && !latitude.trim()) return null;
  const position = [Number(longitude), Number(latitude)];
  if (!longitude.trim() || !latitude.trim() || !isPosition(position)) {
    throw new Error('Enter both coordinates: longitude −180 to 180 and latitude −90 to 90.');
  }
  return position;
}

const same = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];

export function boundaryFromVertices(vertices: Position[]): SiteBoundary | null {
  if (!vertices.length) return null;
  if (vertices.length < 3 || vertices.length > 256 || !vertices.every(isPosition)) {
    throw new Error('Use 3 to 256 valid perimeter vertices.');
  }
  const ring = [...vertices, vertices[0]];
  const orientation = (a: Position, b: Position, c: Position) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const overlaps = (a: number, b: number, c: number, d: number) =>
    Math.max(a, b) >= Math.min(c, d) && Math.max(c, d) >= Math.min(a, b);
  const origin = vertices[0];
  let area = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = ring[i], b = ring[i + 1];
    if (same(a, b) || Math.abs(a[0] - b[0]) > 180) {
      throw new Error('Remove repeated vertices and edges that cross the antimeridian.');
    }
    const previous = vertices[(i + vertices.length - 1) % vertices.length];
    if (orientation(previous, a, b) === 0
      && (previous[0] - a[0]) * (b[0] - a[0]) + (previous[1] - a[1]) * (b[1] - a[1]) > 0) {
      throw new Error('The perimeter doubles back along an edge.');
    }
    area += orientation(origin, a, b);
    for (let j = i + 2; j < vertices.length; j++) {
      if (i === 0 && j === vertices.length - 1) continue;
      const c = ring[j], d = ring[j + 1];
      if (overlaps(a[0], b[0], c[0], d[0]) && overlaps(a[1], b[1], c[1], d[1])
        && orientation(a, b, c) * orientation(a, b, d) <= 0
        && orientation(c, d, a) * orientation(c, d, b) <= 0) {
        throw new Error('The perimeter edges intersect. Move or remove a vertex.');
      }
    }
  }
  if (!area) throw new Error('The perimeter must enclose an area.');
  return {type: 'Polygon', coordinates: [ring]};
}

export function siteSaveMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    if (error.code === 'PT409') return 'Another edit was saved first. Close this editor and refresh the site before retrying.';
    if (error.code === '23505') return 'This code is already in use.';
    if (error.code === '42501') return 'Your account cannot make this change at this site.';
  }
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'The server did not confirm the save. Refresh before retrying.';
}
