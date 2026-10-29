# Hosted model choice

Dave authorized hosted model selection and normal delivery on October 29, 2026.

Provide a persisted Anthropic model selector in Provider Settings. Keep Sonnet
4.6 as the existing default. Offer reviewed, priced Haiku, Sonnet and Opus 5.5
and 4.x models. The existing proxy supplies the configured catalogue on GET;
this performs no upstream call and exposes no credentials. Configured model
restrictions can reduce the catalogue. Unsupported or unpriced selections fail
before inference rather than silently using another model.

Keep the current shared-key cycle budget, daily allocation, request ceilings,
input/output limits, timeouts, cancellation, owner policy and conservative
reservation/settlement. No higher budget, provider expansion, account sync or
new dependency. Pricing remains in the existing server budget table. Selection
uses the existing local provider settings and does not alter saved prompts.

Support the newer models' sampling restrictions. Record the upstream stream's
reported model where available, then the hosted routing header, then the local
resolved model. Verify the selected model in captured upstream requests and real
production runs, including reload and saved run history. Invalid-model and
budget refusals must make zero provider calls. Test desktop/mobile settings,
unavailable catalogue, existing default, custom desktop settings and cancellation.

Sources: https://platform.claude.com/docs/en/models/overview and
https://platform.claude.com/docs/en/about-claude/pricing (October 29, 2026).
The unrelated Undo save receipt issue is outside this change.
