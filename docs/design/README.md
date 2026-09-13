# Design reference

`review-console.canvas.html` is the review console's visual design, as the repo owner approved
it: the markup and inline styles extracted from the Claude Design canvas they supplied
(`Wellis Review Console.html`, a self-unpacking bundle that is not checked in — the 41 KB of
source below is what it renders).

It is a **reference, not a build artifact**. Nothing imports it and nothing tests against it. It
is here so the palette, the spacing and the shape of every pane can be read next to the code that
implements them, and so the next session can tell an intentional divergence from a drift.

Read it with the browser or with an editor; the design's own data — ten item kinds with counts,
twelve worked examples of the detail pane — sits in the `<script type="text/x-dc">` block at the
end and is illustrative, not the product's data.

What the implementation takes from it, and the three places it deliberately departs, are in
[ADR-0028](../adr/0028-the-review-console-is-three-panes.md).
