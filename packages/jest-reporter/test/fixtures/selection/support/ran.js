// Each test body writes its name to RAN_FILE: what ran, whatever Jest and the reporter say.
const { appendFileSync } = require('node:fs');

exports.ran = (name) => appendFileSync(process.env.RAN_FILE, `${name}\n`);
