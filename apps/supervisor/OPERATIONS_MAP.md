# Supervisor Operations Map

The Operations Map uses the same MapLibre style and Baseguard controls as the site
editor. It intersects the current operational site scope with active records from
`list_managed_sites` and reads posts through `list_site_security_posts`. The
server enforces site access for both calls. The browser draws active posts only
and never queries the geographic tables directly.

Centers and posts use longitude-first WGS84 points. Perimeters use the saved
single-ring Polygon. A boundary-only site fits to its perimeter and has no
synthetic marker. A post outside the perimeter remains selectable and displays a
warning. Geometry beyond the basemap's Web Mercator latitude limits is retained
in the database but left unplotted. The map distinguishes sites without plottable
geometry, hidden layers, incomplete post results, and basemap failure.

The local map selector and layer controls fit the visible features. Selecting a
post focuses its configured position. Opening Sites from the details panel selects
the corresponding directory record without changing the dashboard scope. The
explicit dashboard filter action changes the operational scope.

Open high or critical incidents from the existing authorized feed can give a
configured site center a red marker. Its position remains the site's configured
center. A confirmed duty session does not establish geographic presence or full
coverage. Normal site center markers are grey until an authoritative coverage
source exists. The map has no guard positions, SOS feed or patrol telemetry.

MapLibre loads the OpenFreeMap Positron style by default and displays its
attribution. Set `VITE_OPERATIONS_MAP_STYLE_URL` to an approved HTTPS style to
change providers. The tile provider receives viewport tile requests. Geographic
records are applied as client-side layers and are not sent as a marker feed.
Choose a provider consistent with organizational privacy and availability requirements.

Future incident coordinates, guard positions, SOS, geofences and routes can be
fed into separate authorized layers on the shared map canvas. See
[the database contract](../../supabase/GEOGRAPHY_4B.md) for authorization, validation
and deployment prerequisites.
