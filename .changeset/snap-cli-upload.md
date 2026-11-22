---
'@probara/cli': minor
---

`probara snap upload <dir>` sends every `.png` file under a directory, in its folders too, as the
screenshots of one Probara Snap build, each named by its path from the directory without `.png`
(`checkout/cart.png` is `checkout/cart`). `--browser`, `--viewport WxH` and `--color-mode` apply
to them all; `--build-name`, `--nonce`, `--shard <index>/<total>`, `--parallel` and
`--run-ulid` name the build as a reporter does. Exit codes: 0 sent, 1 when a `.png` file is not a PNG
or Probara refused, 2 on a usage error (no directory, one that is missing or holds no `.png`, or no
full commit or branch known).
The commands docs show how to capture the stories of a Storybook and send them this way.
