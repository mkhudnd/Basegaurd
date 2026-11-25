import {useEffect, useState, type FormEvent, type ReactNode} from 'react';
import {Badge, Button, Card, Dialog, Input, Metrics, Select} from './ui';
import {
  createManagedSite, listManagedSites, listSecurityPosts, loadRecords,
  saveSecurityPost, saveSiteGeography, updateManagedSite,
} from './service';
import {boundaryFromVertices, parsePosition, siteSaveMessage, type ManagedSite,
  type Position, type SecurityPost, type SiteBoundary} from './site-geography';
import {SiteEditorMap} from './SiteEditorMap';

type Load<T> = {state: 'loading'} | {state: 'ready'; data: T} | {state: 'error'; error: unknown};
type Summary = {onDuty?: number; scheduled?: number; incidents?: number};
const loading = {state: 'loading'} as const;
const missing = (error: unknown) => error && typeof error === 'object' && 'code' in error && error.code === 'PGRST202';

function useLoad<T>(key: string, load: (signal: AbortSignal) => Promise<T>): Load<T> {
  const [entry, setEntry] = useState<{key: string; result: Load<T>}>();
  useEffect(() => {
    const request = new AbortController();
    void load(request.signal).then(
      data => { if (!request.signal.aborted) setEntry({key, result: {state: 'ready', data}}); },
      error => { if (!request.signal.aborted) setEntry({key, result: {state: 'error', error}}); },
    );
    return () => request.abort();
  }, [key]);
  return entry?.key === key ? entry.result : loading;
}

function LoadNotice({message, error, retry}: {message: string; error: unknown; retry: () => void}) {
  return <p className="inline-note error" role="alert">{message} {siteSaveMessage(error)}{' '}
    <button type="button" className="text-btn" onClick={retry}>Retry</button></p>;
}

function configured(site: ManagedSite) {
  if (site.center && site.boundary) return 'Center and perimeter';
  if (site.center) return 'Center only';
  if (site.boundary) return 'Perimeter only';
  return 'Geography not configured';
}

export function SitesWorkspace({isAdmin, onSiteChange, initialSiteId = ''}: {
  isAdmin: boolean; onSiteChange: () => void; initialSiteId?: string;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [version, setVersion] = useState(0);
  const [selectedId, setSelectedId] = useState(initialSiteId);
  const [creating, setCreating] = useState(false);
  const [receipt, setReceipt] = useState('');
  const read = useLoad(String(version), listManagedSites);
  const retry = () => setVersion(n => n + 1);
  const sites = read.state === 'ready' ? read.data : [];
  const visible = sites.filter(site => (filter === 'all' || site.is_active === (filter === 'active'))
    && (site.name + ' ' + site.code).toLowerCase().includes(query.trim().toLowerCase()));
  const selected = visible.find(site => site.id === selectedId) ?? visible[0];

  function siteSaved(site: ManagedSite) {
    setSelectedId(site.id);
    setFilter('all');
    setQuery('');
    setReceipt(site.name + ' saved.');
    setCreating(false);
    retry();
    onSiteChange();
  }

  return <div className="site-workspace">
    <Card title="Site directory" subtitle="Active and inactive sites within your management assignments"
      action={isAdmin && read.state === 'ready' && <Button variant="primary" onClick={() => setCreating(true)}>Create site</Button>}>
      <div className="site-filters">
        <label>Search by name or code<Input type="search" value={query} onChange={e => setQuery(e.target.value)} /></label>
        <label>Operational state<Select value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="all">All sites</option><option value="active">Active</option><option value="inactive">Inactive</option>
        </Select></label>
      </div>
      {receipt && <p className="inline-note success" role="status">{receipt}</p>}
      {read.state === 'loading' && <p className="empty" role="status">Loading site directory…</p>}
      {read.state === 'error' && <LoadNotice message={missing(read.error) ? 'Site management is unavailable.' : 'Could not load sites.'} error={read.error} retry={retry} />}
      {read.state === 'ready' && (visible.length ? <div className="site-directory" aria-label="Site results">
        {visible.map(site => <button type="button" className="site-directory-row" key={site.id}
          aria-pressed={selected?.id === site.id} onClick={() => { setSelectedId(site.id); setReceipt(''); }}>
          <span><strong>{site.name}</strong><small>{site.code} · {configured(site)}</small></span>
          <Badge value={site.is_active ? 'Active' : 'Inactive'} />
        </button>)}
      </div> : <p className="empty">{sites.length ? 'No sites match these filters.' : 'No sites in your management scope.'}</p>)}
    </Card>
    {selected && <SiteDetail key={selected.id} site={selected} onSiteSaved={siteSaved} />}
    {creating && <SiteForm site={null} close={() => setCreating(false)} saved={siteSaved} />}
  </div>;
}

async function loadSummary(siteId: string, signal: AbortSignal): Promise<Summary> {
  const [shifts, incidents] = await Promise.allSettled([
    loadRecords('shifts', siteId, signal), loadRecords('incidents', siteId, signal),
  ]);
  const now = Date.now();
  const shiftRows = shifts.status === 'fulfilled' ? shifts.value : undefined;
  const present = shiftRows?.filter(row => row.status === 'active' && Date.parse(row.started_at) <= now
    && (!row.ended_at || Date.parse(row.ended_at) > now));
  return {
    onDuty: present?.every(row => typeof row.presence_status === 'string')
      ? new Set(present.filter(row => row.presence_status === 'on_duty').map(row => row.guard_id)).size : undefined,
    scheduled: shiftRows?.filter(row => row.status === 'scheduled' && Date.parse(row.started_at) > now).length,
    incidents: incidents.status === 'fulfilled'
      ? incidents.value.filter(row => !['resolved', 'closed'].includes(row.status)).length : undefined,
  };
}

function SiteDetail({site, onSiteSaved}: {site: ManagedSite; onSiteSaved: (site: ManagedSite) => void}) {
  const [editSite, setEditSite] = useState(false);
  const [editGeography, setEditGeography] = useState(false);
  const [editPost, setEditPost] = useState<SecurityPost | null | undefined>(undefined);
  const [version, setVersion] = useState(0);
  const [receipt, setReceipt] = useState('');
  const key = site.id + ':' + version;
  const posts = useLoad(key, signal => listSecurityPosts(site.id, signal));
  const summary = useLoad<Summary>(key + ':' + site.is_active, signal => site.is_active ? loadSummary(site.id, signal) : Promise.resolve({}));
  const postRows = posts.state === 'ready' ? posts.data : [];
  const totals = summary.state === 'ready' ? summary.data : {};
  const retry = () => setVersion(n => n + 1);

  return <div className="sections site-detail" aria-label="Selected site">
    <Card title={site.name} subtitle={site.code + ' · ' + (site.is_active ? 'Active' : 'Inactive')}
      action={(site.can_edit || site.can_manage_status) && <Button onClick={() => setEditSite(true)}>Edit site</Button>}>
      <p className="inline-note">Geography: <strong>{configured(site)}</strong></p>
      {site.details && <p className="inline-note site-description">{site.details}</p>}
      {!site.is_active && <p className="inline-note">Operational records are unavailable while the site is inactive.</p>}
      {site.is_active && summary.state === 'loading' && <p className="inline-note" role="status">Loading operational summary…</p>}
      {site.is_active && (summary.state === 'error' || (summary.state === 'ready' &&
        [totals.onDuty, totals.scheduled, totals.incidents].some(value => value === undefined))) &&
        <p className="inline-note" role="status">Some operational totals are unavailable. <button type="button" className="text-btn" onClick={retry}>Refresh totals</button></p>}
      <Metrics items={[
        {title:'On duty', value:totals.onDuty, note:'Confirmed guards', icon:'guards'},
        {title:'Upcoming shifts', value:totals.scheduled, note:'Scheduled starts', icon:'clock'},
        {title:'Open incidents', value:totals.incidents, note:'Authorized records', icon:'incidents'},
        {title:'Active posts', value:posts.state === 'ready' ? postRows.filter(post => post.is_active).length : undefined,
          note:posts.state === 'ready' ? postRows.length + ' total' : 'Post count unavailable', icon:'sites'},
      ]} />
    </Card>
    <Card title="Site map" subtitle={configured(site)}
      action={site.can_edit && <Button onClick={() => setEditGeography(true)}>Edit geography</Button>}>
      <SiteEditorMap center={site.center?.coordinates ?? null} boundary={site.boundary} vertices={[]} posts={postRows} />
    </Card>
    <Card title="Security posts" subtitle="Operational post names and geographic points"
      action={site.can_edit && posts.state === 'ready' && <Button onClick={() => setEditPost(null)}>Add post</Button>}>
      {posts.state === 'loading' && <p className="empty" role="status">Loading posts…</p>}
      {posts.state === 'error' && <LoadNotice message="Posts are unavailable." error={posts.error} retry={retry} />}
      {receipt && <p className="inline-note success" role="status">{receipt}</p>}
      {posts.state === 'ready' && (postRows.length ? <div className="site-post-list">
        {postRows.map(post => <div className="site-post-row" key={post.id}>
          <div><strong>{post.name}</strong><small>{post.code} · {post.location ? 'Location configured' : 'No location'}</small>
            {post.outside_boundary && <small className="site-warning">Outside the site perimeter</small>}</div>
          <Badge value={post.is_active ? 'Active' : 'Inactive'} />
          {site.can_edit && <Button onClick={() => setEditPost(post)}>Edit post</Button>}
        </div>)}
      </div> : <p className="empty">No security posts configured.</p>)}
    </Card>
    {editSite && <SiteForm site={site} close={() => setEditSite(false)} saved={result => { setEditSite(false); onSiteSaved(result); }} />}
    {editGeography && <GeographyForm site={site} posts={postRows} close={() => setEditGeography(false)}
      saved={result => { setEditGeography(false); onSiteSaved(result); }} />}
    {editPost !== undefined && <PostForm site={site} post={editPost} posts={postRows} close={() => setEditPost(undefined)}
      saved={result => { setEditPost(undefined); setReceipt(result.name + ' saved.'); retry(); }} />}
  </div>;
}

function SaveDialog({title, close, submit, children, disabled}: {
  title: string; close: () => void; submit: () => Promise<void>; children: ReactNode; disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailure('');
    try { await submit(); }
    catch (error) { setFailure(siteSaveMessage(error)); }
    finally { setBusy(false); }
  }
  return <Dialog title={title} onClose={() => { if (!busy) close(); }}>
    <form className="site-form" onSubmit={save}>
      <fieldset disabled={busy}>{children}</fieldset>
      {failure && <p className="error" role="alert">{failure}</p>}
      <div className="modal-actions"><Button onClick={close} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={busy || disabled}>{busy ? 'Saving…' : 'Save'}</Button></div>
    </form>
  </Dialog>;
}

function SiteForm({site, close, saved}: {site: ManagedSite | null; close: () => void; saved: (site: ManagedSite) => void}) {
  const [name, setName] = useState(site?.name ?? '');
  const [code, setCode] = useState(site?.code ?? '');
  const [active, setActive] = useState(site?.is_active ?? true);
  const [confirmed, setConfirmed] = useState(false);
  const deactivating = Boolean(site?.is_active && !active);
  return <SaveDialog title={site ? 'Edit site' : 'Create site'} close={close} disabled={deactivating && !confirmed}
    submit={async () => saved(await (site ? updateManagedSite(site, name, active) : createManagedSite(code, name)))}>
    <label>Site code<Input value={code} onChange={e => setCode(e.target.value)} readOnly={Boolean(site)}
      required minLength={2} maxLength={30} pattern={codePattern} /></label>
    <label>Site name<Input value={name} onChange={e => setName(e.target.value)} required minLength={2} maxLength={120} /></label>
    {site?.can_manage_status && <label>Operational state<Select value={String(active)} onChange={e => { setActive(e.target.value === 'true'); setConfirmed(false); }}>
      <option value="true">Active</option><option value="false">Inactive</option></Select></label>}
    {deactivating && <label className="site-warning"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
      I checked for unsynced guard records. Deactivation can block them from syncing.</label>}
  </SaveDialog>;
}

type Fields = {longitude: string; latitude: string};
const fromPosition = (value?: Position | null): Fields => value
  ? {longitude: String(value[0]), latitude: String(value[1])} : {longitude: '', latitude: ''};
const readPosition = (value: Fields) => parsePosition(value.longitude, value.latitude);
const codePattern = '[A-Za-z0-9][A-Za-z0-9_\\-]{1,29}';
function previewPosition(value: Fields) { try { return readPosition(value); } catch { return null; } }

function Coordinates({title, value, change}: {title: string; value: Fields; change: (value: Fields) => void}) {
  return <div className="site-coordinate-fields" role="group" aria-label={title}>
    <label>{title} longitude<Input type="number" step="any" min={-180} max={180} value={value.longitude}
      onChange={e => change({...value, longitude: e.target.value})} /></label>
    <label>{title} latitude<Input type="number" step="any" min={-90} max={90} value={value.latitude}
      onChange={e => change({...value, latitude: e.target.value})} /></label>
  </div>;
}

function GeographyForm({site, posts, close, saved}: {
  site: ManagedSite; posts: SecurityPost[]; close: () => void; saved: (site: ManagedSite) => void;
}) {
  const [details, setDetails] = useState(site.details ?? '');
  const [center, setCenter] = useState(fromPosition(site.center?.coordinates));
  const [vertices, setVertices] = useState(site.boundary?.coordinates[0].slice(0, -1) ?? []);
  const [mode, setMode] = useState<'browse' | 'center' | 'add' | 'move'>('browse');
  const [vertex, setVertex] = useState<number | null>(null);
  const [vertexFields, setVertexFields] = useState(fromPosition());
  const [vertexError, setVertexError] = useState('');
  let boundary: SiteBoundary | null = null;
  let validation = '';
  try { boundary = boundaryFromVertices(vertices); }
  catch (error) { validation = siteSaveMessage(error); }

  function setVertexPosition(position: Position) {
    if (vertex !== null) {
      setVertices(rows => rows.map((row, index) => index === vertex ? position : row));
      setVertexFields(fromPosition(position));
    } else if (vertices.length < 256) {
      setVertices(rows => [...rows, position]);
    }
    setVertexError('');
  }

  return <SaveDialog title="Edit site geography" close={close} disabled={Boolean(validation)}
    submit={async () => {
      const point = readPosition(center);
      saved(await saveSiteGeography(site, details, point ? {type:'Point', coordinates:point} : null, boundary));
    }}>
    <label>Site details<textarea className="field" value={details} maxLength={2000} onChange={e => setDetails(e.target.value)} /></label>
    <Coordinates title="Site center" value={center} change={setCenter} />
    <label>Map interaction<Select value={mode} onChange={e => setMode(e.target.value as typeof mode)}>
      <option value="browse">Navigate map</option><option value="center">Click to set site center</option>
      <option value="add">Click to add perimeter vertices</option><option value="move" disabled={vertex === null}>Click to move selected vertex</option>
    </Select></label>
    <SiteEditorMap center={previewPosition(center)} boundary={boundary} vertices={vertices} posts={posts} vertexIndex={vertex}
      onPick={mode === 'browse' ? undefined : point => {
        if (mode === 'center') setCenter(fromPosition(point));
        if (mode === 'add' && vertices.length < 256) setVertices(rows => [...rows, point]);
        if (mode === 'move' && vertex !== null) setVertexPosition(point);
      }} />
    <label>Perimeter vertex ({vertices.length}/256)<Select value={vertex ?? ''} onChange={e => {
      const index = e.target.value === '' ? null : Number(e.target.value);
      setVertex(index); setVertexFields(fromPosition(index === null ? null : vertices[index]));
      if (index === null && mode === 'move') setMode('browse');
    }}><option value="">New vertex</option>{vertices.map((_, index) => <option key={index} value={index}>Vertex {index + 1}</option>)}</Select></label>
    <Coordinates title="Vertex" value={vertexFields} change={setVertexFields} />
    <div className="site-form-actions">
      <Button disabled={vertex === null && vertices.length >= 256} onClick={() => {
        try {
          const position = readPosition(vertexFields);
          if (!position) throw new Error('Enter a vertex longitude and latitude.');
          setVertexPosition(position);
        } catch (error) { setVertexError(siteSaveMessage(error)); }
      }}>{vertex === null ? 'Add vertex' : 'Update vertex'}</Button>
      <Button disabled={vertex === null} onClick={() => {
        setVertices(rows => rows.filter((_, index) => index !== vertex));
        setVertex(null); setVertexFields(fromPosition()); setMode('browse');
      }}>Remove selected vertex</Button>
      <Button disabled={!vertices.length} onClick={() => {
        setVertices([]); setVertex(null); setVertexFields(fromPosition()); setMode('browse');
      }}>Clear perimeter</Button>
    </div>
    {vertexError && <p className="error" role="alert">{vertexError}</p>}
    <p className={validation ? 'error' : 'inline-note'} role="status">{validation || (boundary ? 'Perimeter ready to save.' : 'No perimeter in this draft.')}</p>
  </SaveDialog>;
}

function PostForm({site, post, posts, close, saved}: {
  site: ManagedSite; post: SecurityPost | null; posts: SecurityPost[]; close: () => void; saved: (post: SecurityPost) => void;
}) {
  const [code, setCode] = useState(post?.code ?? '');
  const [name, setName] = useState(post?.name ?? '');
  const [active, setActive] = useState(post?.is_active ?? true);
  const [position, setPosition] = useState(fromPosition(post?.location?.coordinates));
  const [picking, setPicking] = useState(false);
  return <SaveDialog title={post ? 'Edit security post' : 'Add security post'} close={close}
    submit={async () => {
      const point = readPosition(position);
      saved(await saveSecurityPost(site.id, post, code, name, active, point ? {type:'Point', coordinates:point} : null));
    }}>
    <label>Post code<Input required minLength={2} maxLength={30} pattern={codePattern} value={code}
      onChange={e => setCode(e.target.value)} /></label>
    <label>Post name<Input required minLength={2} maxLength={120} value={name} onChange={e => setName(e.target.value)} /></label>
    {post && <label>Post state<Select value={String(active)} onChange={e => setActive(e.target.value === 'true')}>
      <option value="true">Active</option><option value="false">Inactive</option></Select></label>}
    <Coordinates title="Post" value={position} change={setPosition} />
    <Button aria-pressed={picking} onClick={() => setPicking(value => !value)}>{picking ? 'Stop picking location' : 'Pick location on map'}</Button>
    <SiteEditorMap center={site.center?.coordinates ?? null} boundary={site.boundary} vertices={[]}
      posts={posts.filter(row => row.id !== post?.id)} postDraft={previewPosition(position)}
      onPick={picking ? point => { setPosition(fromPosition(point)); setPicking(false); } : undefined} />
  </SaveDialog>;
}
