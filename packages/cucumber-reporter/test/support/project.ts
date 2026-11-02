/**
 * The hand-written Cucumber project of the end-to-end tests: its feature files and step definitions.
 * Each test writes the files it needs, so the expected results read beside the scenarios they are for.
 */

/** Step definitions for every feature below: a failure, a pending step, an ambiguous step and attachments. */
export const STEPS = `const { Given, When, Then, Before, After } = require('@cucumber/cucumber');

Given('a cart with a book', function () {});
When('the customer pays with the saved card', function () {});
Then('the order is confirmed', function () {});
When('the customer sends the receipt:', function (text) {});
Then('the receipt table is:', function (table) {});
When('the customer pays {int} with {word}', function (amount, method) {});
Given('a page with a card', function () {});
When('the customer pays with a declined card', function () {
  throw new Error('The card was declined');
});
Given('a pending step', function () {
  return 'pending';
});
Given('an ambiguous step', function () {});
Given(/^an ambiguous (step)$/, function () {});
When('the page is shown', function () {
  this.attach('the page text', 'text/plain');
  this.log('a log line');
  this.attach(Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'image/png');
});
Before({ tags: '@attachments' }, function () {
  this.attach('before text', 'text/plain');
});
After({ tags: '@broken-hook' }, function () {
  throw new Error('cleanup broke');
});
`;

/** Checkout: a Background, a plain scenario with a case tag, a Doc String and a Data Table, an outline. */
export const PAY = `Feature: Checkout

  Background:
    Given a cart with a book

  @probara:SHOP-12
  Scenario: Pay with the saved card
    When the customer pays with the saved card
    Then the order is confirmed

  Scenario: Send the receipt
    When the customer sends the receipt:
      """
      Thank you for the order.
      """
    Then the receipt table is:
      | item | price |
      | book | 12    |

  Scenario Outline: Pay with <method>
    When the customer pays <amount> with <method>
    Then the order is confirmed

    Examples:
      | method | amount |
      | visa   | 12     |
      | paypal | 30     |
`;

/** Scenarios whose outcomes differ: a failed step, a step with no definition, pending, ambiguous. */
export const OUTCOMES = `Feature: Outcomes

  Scenario: A declined card fails
    Given a page with a card
    When the customer pays with a declined card
    Then the order is confirmed

  Scenario: A page with no step definition
    Given a page nobody defined

  Scenario: A step that is still pending
    Given a pending step

  Scenario: A step that matches two definitions
    Given an ambiguous step
`;

/** A scenario whose After hook fails. */
export const HOOKS = `Feature: Hooks

  @broken-hook
  Scenario: The after hook breaks
    Given a cart with a book
`;

/** A scenario that attaches text, a log and an image, and a Before hook that attaches text. */
export const MEDIA = `Feature: Media

  @attachments
  Scenario: The page is shown
    When the page is shown
`;
