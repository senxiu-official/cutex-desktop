# Portless services

This desktop supports background apps on hosts advertising `services-workers-v1`.
The existing public backend does not yet advertise this capability.

A worker is a supervised process with no web port, URL or HTTP health probe. The daemon
owns its definition, execution approval, lifetime, logs, process supervision and permissions.
The desktop displays its status and offers the available controls; it never opens port zero
or creates a browser page for a worker. Existing managed, static and external services
retain their existing behavior. A running worker health value confirms process liveness.

The existing service list and changed events carry worker records with null web fields.
Control and ownership changes use the existing daemon service APIs. A manually stopped
worker stays stopped across desktop reconnects. Worker and web runtimes cannot be converted
in place. Removing a registration retains application data.

Module background installation is a later phase: this release does not let third-party
modules install background executables or add a public module API for them. A supervised
worker runs with the account's full trust; process supervision is not a filesystem or
network sandbox.
