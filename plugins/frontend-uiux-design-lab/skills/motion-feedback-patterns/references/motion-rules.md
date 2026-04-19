# Motion Rules

## Purpose First

- Motion should explain a change in state, hierarchy, or spatial relationship.
- If the animation does not teach the user something, question whether it belongs.

## Timing

- fast feedback: `120ms` to `180ms`
- inline surface changes: `180ms` to `280ms`
- route or large panel changes: `280ms` to `420ms`

## Easing

- Use one standard easing curve for most UI work, such as a smooth ease-out.
- Save springier or elastic motion for playful brands and low-risk surfaces.

## Safe Patterns

- fade and slight translate for reveal
- scale and shadow shift for hover or press
- anchored slide for drawers and sheets
- opacity plus position for toast and status feedback

## Avoid

- infinite decorative motion
- motion that creates layout shift
- animations that delay access to primary content
