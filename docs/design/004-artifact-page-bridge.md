# Artifact page bridge

Artifact HTML runs in an opaque sandbox without network access, credentials, Node or preload APIs. The application accepts exactly three fixed-schema channels: storage belonging to that artifact, submission to its agent after a native confirmation, and clipboard copy during a user gesture. Storage is limited to 5 MB per artifact with a 200 MB soft aggregate limit; stored data is not automatically evicted. Main validates the requesting frame instance and every operation. See the security contract in [Desktop modules](../desktop-modules.md).

See [Architecture](../DESIGN.md) and [Module contracts](../desktop-modules.md) for related interfaces.
