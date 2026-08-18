# Kubri canonical document renderer

`@kubri/document-renderer` is the single source for all current A4 and thermal
paper compositions. It is intentionally presentation-only: callers supply an
already-authoritative immutable `DocumentViewModel` and an authoritative QR
image; this module neither reads nor mutates business data.

Web and Electron import the React compositions through the compatibility
exports under `src/components/print`. Mobile consumes a generated artifact of
`src/staticHtml.tsx`, pinned to the same package version and source revision.
Current template changes must begin here. Never create a separate mobile
composition for a current template.
