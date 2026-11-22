# Model catalog, reasoning effort and aliases

The model catalog presents supported models with their context and reasoning options. Display labels remain separate from provider identifiers. A missing current model is reported without silently switching the session. Capability and generation checks prevent stale catalogs from validating a new runtime.

## Explicit reasoning effort

Effort labels show a concrete level. Unreported values show an em dash with an explanation; a trusted empty supported-level list shows Unsupported. Claude's `none` setting means that the runtime chooses a default, rather than a concrete effort level. Host-resolved values and skipped unsupported settings are used when reported. Older hosts use only their available supported values, or show Unreported; the interface does not invent a resolved value.

Model and context settings share one layout across runtimes. Per-field sources explain session, per-model, Profile and runtime defaults. Unsupported controls retain their stored values with an explanation. Batch changes preview each target and report each result.

## Claude aliases

An alias label is its family and known display version, for example **Opus 5.5**. A trusted SDK handshake display version has priority. In the conversation composer only, the most recent answering model's catalog display name can supply the version. Without either source, the label is simply **Opus**. Raw provider ids and the newest unrelated catalog entry do not supply an alias display version.

The menu and model catalog mark alias rows Follow latest, including one-million-context aliases. A fixed model of the same version has no such marker. A separate answering-model explanation appears only when the answering model differs from the label's family or version. Session handshake fields replace a catalog alias resolution as a whole when they refer to the current requested model.

These rules apply to the composer, new-agent form, quick chat, batch model changes, Profile controls and model catalog. Older hosts, including backend 0.2.5, can omit the optional resolution fields; the described fallbacks remain available.
