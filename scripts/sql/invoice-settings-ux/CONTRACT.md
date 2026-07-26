# V1 invoice-settings persistence contract

`branches.presentation_settings` stores one active V1 envelope:

```json
{
  "schema_version": 1,
  "language": "en | ar | both",
  "after_sale_action": "receipt | a4 | both",
  "branding": {
    "heading_mode": "branch | custom",
    "custom_heading": null,
    "subheading": null,
    "show_company_name": true,
    "logo_path": null,
    "logo_size": "small | medium | large"
  },
  "contact": {
    "show_phone": true,
    "phone_override": null,
    "show_email": true,
    "email": null,
    "show_website": true,
    "website": null,
    "show_address": true,
    "address_override": null
  },
  "footer": { "message": null, "bold": false },
  "thermal": {
    "width": "58mm | 80mm",
    "density": "compact | standard | detailed",
    "qr_size": "small | medium | large",
    "qr_alignment": "left | center | right"
  },
  "a4": { "theme": "classic | modern_split | minimal_professional" }
}
```

The frontend runtime normalizer still reads the previous `identity`, `logo`,
`footer_note`, `template_id`, `thermal`, `pdf`, `ask`, and `none` forms for legacy
branches. Successful V1 saves serialize only the envelope above. The internal
renderer model is not a second persisted contract; it is the normalized runtime
representation consumed by the existing document adapters.

Logo paths remain compatible with the current `branch-assets` setup:

- `<branch_id>/logo.jpg`
- `<branch_id>/logo.jpeg`
- `<branch_id>/logo.png`
- `<branch_id>/logo.webp`

Existing public URLs and previously stored versioned paths remain readable. New
immutable/versioned Storage paths, policies, and triggers are deferred hardening.

`get_branch_invoice_settings(uuid)` returns `branch_id`, `presentation_settings`,
`invoice_language`, `print_mode`, `can_edit`, and `role`. Both RPCs retain their
existing signatures, `jsonb` return types, `SECURITY DEFINER`, protected
`search_path`, and owner/assigned-branch authorization rules.
