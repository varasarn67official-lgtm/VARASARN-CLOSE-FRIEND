# Original interface reference

The original single-page interface is the parent of commit `0b1b1c8`:

```bash
git show 0b1b1c8^:index.html
```

`old-repo/index.html` is a later Vite entry page, not the original interface. Use the Git version above when comparing rendered pages.

The original home page has a purple gradient navigation bar, a banner image at `https://i.postimg.cc/FFk3NRHV/IMG-0677.jpg`, the centered about card and student-committee copy, an Instagram contact link, a `รายวิชาทั้งหมด` heading, a pill search field, horizontally scrolling category buttons, and three course-card columns from the medium breakpoint. The course cards use a five-pixel purple gradient top line, a category badge, code title, and two-line name. The contact button floats at bottom right.

The original review detail is a large modal with a gradient title bar, a separate review-composer collapse, filters, and review cards. My Reviews is a two-column card grid. The timetable uses the same 08:00–19:00 grid and six color classes. New administrator and proposal controls should reuse those tokens and card patterns.

The original tokens are `#2a1b47`, `#6f42c1`, `#7c4fda`, `#c9b3f0`, `#f2ecfb`, `#fbf9ff`, `#f5a623`, and `#e7e1f5`, with Prompt body text and Kanit headings. The rebuilt app must keep interactions in Vue and authenticated data in Neon.
