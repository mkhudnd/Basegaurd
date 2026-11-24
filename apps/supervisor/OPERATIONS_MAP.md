# Supervisor Operations Map data contract

The map reads optional numeric `latitude` and `longitude` from the same RLS-filtered
`sites` query as the site selector. The repository schema currently has neither.
The workspace falls back to the existing site fields when Postgres reports a missing column.
No points are rendered without valid WGS84 coordinates.

A future migration should add nullable numeric coordinates with range and paired-null
constraints. Populate them from an approved site register through a trusted workflow.
Keep current site RLS in force and verify supervisor access and its denial on a test
database before rollout. No migration is included in this sprint.

Open high or critical incidents come from the existing authorized incident feed. They take marker priority.
A missed check-in alone does not prove that a site lacks coverage. Green and amber require
an authoritative, site-scoped coverage result that takes staffing targets, post assignments
and confirmed check-ins into account. Until that is available, coverage displays as unknown.
There is no separate emergency alert source in the current map.

MapLibre loads the OpenFreeMap Positron style by default and displays its source attribution.
Set `VITE_OPERATIONS_MAP_STYLE_URL` to an approved HTTPS style to change providers.
Choose a provider that meets organizational privacy and availability requirements. The client
requests basemap tiles for the visible area. Site records remain in the browser and are not
sent as a marker feed to the provider.

Additional guard, SOS, incident point, geofence and patrol layers should receive separate,
authorized data sources and use the same map instance. Treat points, lines and polygons
as independent layers. Guard tracking, location collection and live alerts are outside Sprint 1.
