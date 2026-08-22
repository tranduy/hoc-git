# Fail-Closed Opposing Tickets Design

## Goal

Prevent a displayed or alerted two-book ticket from being treated as safe unless the two legs belong to the same independently identified event, exact market/line/settlement, complementary outcomes, and fresh provider-verified stake plan.

## Event identity

Prematch keeps the existing two-minute kickoff tolerance. A live Football event may match only when team orientation and variant agree and at least one independent identity route exists: an equal non-empty fixture discriminator; or equal normalized competition plus kickoff timestamps within two minutes; or complete, compatible period and score evidence from both sources. Missing live evidence must never fall back to participant names alone. Contradictory score or period always rejects the match.

## Opportunity state

`OBSERVATION`, expired evidence, and any plan whose two provider catalogs are not fresh remain visible as neutral read-only monitoring data. They cannot receive a profitable color, rank ahead as a verified opportunity, or generate sound/alerts. Only `VERIFIED_PROFIT` with both provider accounts fresh may alert.

## Verification

Regression tests cover missing live identity, valid independent identity routes, observation sorting/tone, stale/observation alert suppression, complementary outcome domains, and fresh live-catalog audit.
