# Attachments

Files a scenario attaches with the World are uploaded to the result, as the other reporters upload
theirs:

| Call in a step or hook                       | Uploaded as                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------- |
| `this.attach(text, 'text/plain')`            | a text file named `attachment.txt`                                              |
| `this.attach(buffer, 'image/png')`           | an image named `attachment.png`                                                 |
| `this.attach(data, { mediaType, fileName })` | a file named `fileName`, with an extension from its media type when it has none |
| `this.log('a line')`                         | a text file named `log.txt`, one per call                                       |
| `this.link('https://…')`                     | a text file named `link.txt` holding the URL, one per call                      |

```js
When('the page is shown', async function () {
  this.attach(await page.screenshot(), { mediaType: 'image/png', fileName: 'page.png' });
  this.log('the cart had one book');
});
```

- A file attached in a step belongs to that step, and shows with it. A file attached in a `Before` or
  `After` hook belongs to the result.
- `uploadAttachments: false` (`PROBARA_UPLOAD_ATTACHMENTS=false`) uploads no file.
- The limits of every reporter apply: a result sends at most 20 files, and images that Probara
  refuses (PNG, JPEG or WebP over 10 MiB, or over 8192 pixels on a side) are skipped with a warning.
  See [attachments in `@probara/core`](https://github.com/cynch-me/probara-sdk/blob/main/packages/core/README.md#attachments).
- A file that cannot be uploaded does not fail the run: the summary counts it as skipped or failed.
