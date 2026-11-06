# Image submission and persisted references

The desktop uploads an attachment to the host before submitting its message and
uses the persisted reference accepted by that host's advertised input schema.
Uploading bytes and submitting the message are separate steps. Keep the draft
recoverable if either step fails.

Large event images use authenticated blob references when the host advertises
that capability. Inline images and older history-media references remain readable.
Reserve an image's layout space when dimensions are known; an unavailable image
shows a placeholder without failing the conversation.

For a reproduction, record the public desktop and backend versions, supported
capabilities, payload shape, client message ID and response. Do not copy bearer
tokens or private media into a public report. A screenshot of the preview alone
does not prove that the host accepted or persisted the attachment.

Validate transport output against the matching exported Management schema and
check replay/reload behavior using an isolated host. Updating the desktop does
not silently replace the host's backend or an existing agent's runtime pin.
