/**
 * `@probara/cypress-reporter/support`: the browser side of a run, loaded from the Cypress support
 * file with `require('@probara/cypress-reporter/support')`.
 *
 * It is a placeholder in this release: the `probara.*` helpers a test calls (`id`, `title`,
 * `suite`, `comment`, `ignore`, `parameters`, `tags`, `fields`, `link`, `issue`, `attach`,
 * `step`), which send their messages to the plugin with \`cy.task('probara', …)\`, land in the next
 * part of this package. Until then loading it does nothing, and everything else keeps working: the
 * reporter, its screenshots and its video never need it.
 *
 * It loads nothing else: a support file runs in the browser, where Node built-ins are not there.
 */
export {};
