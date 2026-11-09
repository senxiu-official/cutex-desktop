# Notices carried with user messages

On hosts advertising `owner-carries-v1` and `input-ledger-v1`, eligible notices can be delivered with a user message in the same submission. Their canonical identities remain separate from user text. Notices held by the user stay held until explicitly released. A notice that arrives later follows the normal next-step or next-turn path. Native delivery receipts determine consumption; RPC acceptance alone does not imply that context was persisted. Uncertain attempts retain their reservations until an explicit recovery path resolves them.

When an interrupted carrier message is retried on its own, its attached notices do not automatically travel with the retry. Their original reservations remain until the host proves that they were not consumed or exposes an explicit recovery action. A retry that cannot be resolved safely reports why trying again cannot help instead of promising eventual delivery.

When a carrier has ended but an attached notice still has no consumption receipt, the host can expose that notice as uncertain with its own retry and abandon actions. Retrying an uncertain notice can deliver it twice; the interface preserves that warning. A supported runtime can explicitly return an unread reserved notice, allowing its ordinary delivery path to resume. An RPC response alone does not establish that return or consumption occurred.

See [Architecture](../DESIGN.md) and [Module contracts](../desktop-modules.md) for related interfaces.
