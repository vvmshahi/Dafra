# A4 verification artefacts — 2026-07-29

Fixture-only visual evidence is retained locally under:

`.artifacts/a4-verification-20260729/`

The directory is ignored by Git. These files contain typed fixture content,
not production customer information. SHA-256 values describe the preserved
copies. Their source UI commit is
`7f30ae66ede50c184f8517b4b6e421ffebd553d1`.

| File | Bytes | SHA-256 | Fixture-only purpose |
| --- | ---: | --- | --- |
| `kubri-a4-comparison.png` | 305036 | `9acb2f5774dac82ed1cceb7d412611a2e39c3a0169d5128a9e90a3c5c3158aa1` | Side-by-side comparison of the six A4 compositions. |
| `kubri-a4-36-lines-v2.pdf` | 384478 | `0aa079d8e5bd7f7cb259ee4e342cc0beaf6a5f86c54be82a32c18240aab95ac5` | Typed 36-line multi-page A4 PDF fixture. |
| `kubri-a4-36-lines-page1.png` | 121574 | `0958c4c65024dac2f91dcc683c1dc3afb3a3c25ea47eca877c1873ebccd5faeb` | First-page rendering of the multi-page fixture. |
| `kubri-a4-36-lines-page4-v2.png` | 45349 | `ef4f26f7565071e0549e8188a0131455f58d6f8d3552a519f0a1d8d523251adb` | Final-page rendering used to verify totals/footer pagination. |
| `kubri-editor-shell-1366x768-rtl.png` | 38398 | `82a294ca3ab853f0846c6c2014d6a584778d58557ec3d29f757265f92e7c21be` | Arabic/RTL editor shell at 1366×768. |
| `kubri-editor-shell-1024x768.png` | 37956 | `a52122951e6c82b6420656a9e94c0c2c500bae6545f423d37a1e26eacd4b4683` | Editor shell at the compact 1024×768 viewport. |
| `kubri-editor-shell-1440x900.png` | 40767 | `daf4369e432b4ab027fe91642e7d7c2865d67831d15d5ec8eac6b435c1c6f62f` | Editor shell at the 1440×900 reference viewport. |

The artefacts are retained for the controlled rollout record and must not be
committed as binary repository content.
