# User events and environment

## Record user events

```ts
import { createRecordingSession, createUserEventCapture } from '@probara/vis-capture';

const session = createRecordingSession();
const events = createUserEventCapture(session, {
  blur, // optional: a blur controller ([recording.md](recording.md#blur)); blurred elements give no text
  ignore: (element) => element.id === 'my-recorder', // optional: your own controls are not recorded
});

session.start();
events.start();
// ... the user reproduces the bug ...
events.stop();
session.stop();

session.entries('events'); // UserEventEntry[]
```

| Option            | Default  | Meaning                                                                                      |
| ----------------- | -------- | -------------------------------------------------------------------------------------------- |
| `target`          | `window` | The window to listen to.                                                                     |
| `blur`            | none     | Anything with `isBlurred(element)`, such as `createBlurController()`.                        |
| `ignore`          | none     | Elements whose clicks, typing, keys and scrolls are not recorded, such as your own controls. |
| `throttleMs`      | `250`    | At most one `scroll` entry per scrolled element, and one `resize`, per window.               |
| `inputDebounceMs` | `500`    | Typing in a field becomes one `input` entry once it pauses this long.                        |

`ignore(element)` is asked about every element in the event's path, a closed shadow root reached
through its host: when it returns `true` for one, or throws, the event is not recorded.

What each entry type holds besides `t`, `ts` and `url` (the page URL, redacted):

| `type`       | Fields                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| `click`      | `target` (the closest link, button, field or ARIA control around what was hit), `x`, `y` (client pixels) |
| `input`      | `target`, `value`: one `*` per character (at most 100), `checked`/`unchecked` for checkboxes and radios  |
| `keypress`   | `target`, `value`: the key name, with its modifiers (`Enter`, `Shift+Tab`, `Control+s`)                  |
| `navigation` | `pushState`, `replaceState`, `popstate` and `hashchange`; `url` is the new URL                           |
| `scroll`     | `x`, `y`: the scroll offset of the page, or of the scrolled element given in `target`                    |
| `resize`     | `x`, `y`: the new viewport width and height                                                              |
| `visibility` | `value`: `visible` or `hidden`                                                                           |

`target` is `{ selector, tag, text? }`. `selector` is a short CSS path: a readable `id`, or a
`data-testid`, `data-test-id`, `data-test`, `data-cy` or `data-qa` attribute, or else tag names with
`:nth-of-type`, at most five steps (`cssSelector(element)` gives it). Generated ids (`:r12:`,
`ember1234`) are skipped.

Privacy rules, always on:

- an input's characters are never recorded: `value` is masked, and a password field records no
  `value` at all;
- keys record only non-character keys and shortcuts with `Control` or `Meta`; typed characters,
  also with `Shift` or `Alt`, record nothing, and neither do characters typed with AltGr (which
  Windows reports as `Control` and `Alt` held together), in any field;
- `text` is at most 80 characters, redacted, and never taken from a field (`input`, `textarea`,
  `select`, `contenteditable`) or from a blurred element. The text of a target leaves out every
  field and every blurred element inside it: a button holding a blurred name records only the rest
  of its label. When the blur check throws, the element is treated as blurred.

Capture never throws into the page. `stop()` records typing still waiting for its pause, and puts
back `history.pushState` and `replaceState` unless another script replaced them after it.

## Collect the environment

```ts
import { collectEnvironment } from '@probara/vis-capture';

const { pageUrl, pageTitle, environment } = await collectEnvironment();
```

The result uses the names and limits of a Vis on creation: `pageUrl`, `pageTitle` and
`environment` (`browser` and `os` as `{ name, version }`, `device` (`desktop`, `tablet` or
`mobile`), `viewport` and `screen` as `{ width, height }` in CSS pixels, `pixelRatio`, `locale`,
`timeZone`, `userAgent`, `networkType`). It never rejects. A value the browser does not expose,
or one outside the limits, is left out: `pageUrl` only for an http(s) URL of at most 2048
characters, with its secrets redacted. In Chromium browsers the client hints give the browser's
full version, the OS version and Windows 11; elsewhere the user agent string is parsed
(`parseUserAgent(userAgent)` exposes that parser). `incognito` is never filled: a page cannot
tell, so only the extension can report it.
