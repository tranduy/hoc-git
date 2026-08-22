# One-VND Balanced Stakes Design

## Goal

The read-only stake calculator accepts whole-VND amounts and calculates the opposing leg so the two outcome profits are as close as possible.

## Behavior

- The display-only policy uses a 1 VND stake step while retaining its existing 1,000 VND assumed minimum.
- Either leg may be the user-entered anchor.
- The calculated leg evaluates the whole-VND values immediately below and above the continuous equal-payout hedge.
- It selects the candidate with the smallest absolute difference between outcome profits; ties select the larger worst-case profit, then the smaller total stake.
- Provider-verified executable constraints remain authoritative and may reject whole-VND amounts when a provider requires a larger step.

## Verification

- Unit tests cover non-round equalization and either-leg anchoring.
- Component tests assert the input advertises a 1 VND step.
- The full web test suite, typecheck, and production build must pass.
