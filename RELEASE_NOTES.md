# Keystone Beat — Homepage and Product Polish

## Summary

This release sharpens Keystone Beat’s identity as a Pennsylvania sports desk for Philly, Pittsburgh, and the colleges. It improves the homepage hierarchy, makes team hubs more useful, clarifies the Odds experience, and gives the shared shell a stronger editorial identity.

## Highlights

### Homepage hierarchy

The homepage now leads with the most useful live and upcoming game context before moving into the broader daily board and editorial content. The revised ordering helps visitors understand what matters now without losing access to the full schedule.

### Pennsylvania-first positioning

The homepage masthead now clearly describes Keystone Beat as the Pennsylvania sports page, with direct language covering Philadelphia, Pittsburgh, and college sports.

### Team hubs

Team directory cards now carry stronger team identity through color accents, logos, sport and league metadata, city, and nickname details. Follow controls are more visible, and team detail pages now present a clearer team-hub identity with a direct Next up matchup link.

### Odds information hierarchy

The Odds page now separates posted lines from scheduled games whose numbers are still pending. Posted spreads, totals, and moneylines remain the primary view, while pending games stay discoverable in a compact schedule. Existing source attribution and responsible-gambling language remain in place.

### Shared brand shell

The global masthead and footer now use a stronger Keystone mark treatment, a subtle accent rule, a Pennsylvania desk signature, and clearer active navigation styling across desktop and mobile contexts.

## Validation

- Targeted ESLint checks passed for every edited route and component.
- Sports regression suite passed: **60 tests, 0 failures**.
- Production build passed for the Cloudflare deployment preset.
- Working tree was clean before preparing this pull request.

## Review notes

This is a presentation and information-architecture release. It does not change external data providers, authentication, publishing permissions, or the underlying sports-data contracts.

## Follow-up recommendations

After merge, perform responsive review at mobile, tablet, and desktop widths, then add route-level smoke coverage for the homepage, team hubs, Odds page, theme switching, and mobile navigation.

---

Release draft prepared September 20, 2026.
