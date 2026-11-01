// Step definitions of the Cucumber JSON fixtures. Steps with no body prove their text only.
const { Before, Given, When, Then } = require('@cucumber/cucumber');

Before(function () {});

Given('a cart with a book', function () {});
Given('a paid order', function () {});
Given('the receipt table is:', function (table) {});
Given('a step that matches two definitions', function () {});
Given(/^a step that matches .*$/, function () {});

When('the customer pays with the saved card', function () {});
When('the customer pays with {word}', function (method) {});
When('the customer pays with a declined card', function () {
  throw new Error('The card was declined');
});
When('the customer sends the receipt:', function (text) {});
When('the customer asks for a refund', function () {});

Then('the order is confirmed', function () {});
Then('the order is confirmed for {int}', function (amount) {});
Then('the receipt is sent', function () {});
Then('the refund is issued', function () {});
Then('a future step is pending', function () {
  return 'pending';
});
Then('the page is shown', function () {});
Then('the cart shows one item', function () {});
