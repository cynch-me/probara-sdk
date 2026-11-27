---
'@probara/node': patch
---

Stack frames carry `module`: a dependency's path from its `node_modules` folder
(`express/lib/router/index`) or your file's path from `appRoot` (`src/routes/orders`, the working
directory unless given), without the extension and with `/` separators, so grouping can use the
module with the function name.
