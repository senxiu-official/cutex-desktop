# Owner message delivery

The host is the authority for owner-message admission, delivery and settlement.
The desktop displays the host's advertised contract and falls back on older hosts.
This document describes the public behavior; internal rollout plans and incident
measurements are not part of the public interface.

## Send, queue and insert

A user action has a stable client message ID. The host records and checks admission
before delivery. Sending, queued, held, failed, delivered and uncertain states must
come from the host rather than a local guess based on an agent's online status.

The timeline and Next up each show only the records assigned to that surface by
the message contract. A failed or held timeline message remains visible so the
owner can inspect, retry or dismiss it. A state change does not create a second copy.

An insert may be accepted for a later tool boundary. Acceptance does not by itself
prove that the runtime read it. Show progress and final receipt separately. A
permanent refusal must leave the record explicitly failed; it must not hold the
queue behind it forever. An uncertain outcome is not automatically resent.

## Controls and compatibility

Pause, interruption and delivery are different actions. The desktop checks each
host's capabilities and uses only the controls it advertises. Existing hosts and
runtime pins keep their supported behavior; upgrading the desktop alone does not
upgrade a host or a runtime.

Use the [Management user-input contract](https://github.com/senxiu-official/cutex/blob/release/docs/management/user-input-delivery.md)
for the wire fields and reason codes. The host owns admission, persistence,
retry and reconciliation. UI changes must not reimplement these rules locally.

## Validation

Check idle and running turns, paused agents, held and failed delivery, reconnect,
replay and duplicate events. Verify the same message ID is retained through retry
and that replay cannot put one record on both surfaces. Tests use isolated homes
and loopback services, with no connection to an owner's running daemon.
