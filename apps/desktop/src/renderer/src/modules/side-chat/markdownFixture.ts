/** A reply exercising the conversation renderer (math, code, table, task list, footnote, links): the side chat
 *  test and the preview's side chat mock (`/side-md` reply) render it. */
export const SIDE_MARKDOWN_FIXTURE = String.raw`Inline math $e^{i\pi}+1=0$ and display:

$$
\int_0^1 x^2\,dx = \tfrac13
$$

Bracket forms: \(a^2+b^2=c^2\) and

\[
\sum_{k=1}^{n} k = \frac{n(n+1)}{2}
\]

` + "```ts\nconst answer: number = 42;\nexport default answer;\n```" + String.raw`

| Name | Value |
| ---- | ----: |
| alpha | 1 |
| beta | 2 |

- [x] done
- [ ] todo

A note[^1], [docs](https://example.com/docs), ` + "`inline code`" + String.raw`, a file [README.md](README.md) and an artifact [report](cutex:artifact/demo).

[^1]: The footnote.
`;
