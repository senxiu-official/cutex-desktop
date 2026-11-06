# Notices carried with user messages

On hosts advertising `owner-carries-v1` and `input-ledger-v1`, eligible notices can be delivered with a user message in the same submission. Their canonical identities remain separate from user text. Notices held by the user stay held until explicitly released. A notice that arrives later follows the normal next-step or next-turn path. Native delivery receipts determine consumption; RPC acceptance alone does not imply that context was persisted. Uncertain attempts retain their reservations until an explicit recovery path resolves them.

See [Architecture](../DESIGN.md) and [Module contracts](../desktop-modules.md) for related interfaces.
