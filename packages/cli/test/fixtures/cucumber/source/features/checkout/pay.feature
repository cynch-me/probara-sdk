@checkout
Feature: Checkout
  Customers pay for their cart.

  Background:
    Given a cart with a book

  @smoke
  Scenario: Pay with the saved card
    When the customer pays with the saved card
    Then the order is confirmed

  Scenario Outline: Pay with <method>
    When the customer pays with <method>
    Then the order is confirmed for <amount>

    Examples: Cards
      | method | amount |
      | visa   | 12     |
      | paypal | 30     |

  Scenario: Send the receipt
    When the customer sends the receipt:
      """
      Thank you for the order.
      """
    And the receipt table is:
      | item | price |
      | book | 12    |
    Then the receipt is sent

  Rule: Refunds
    Background:
      Given a paid order

    Scenario: Refund a paid order
      When the customer asks for a refund
      Then the refund is issued

  Scenario: A declined card fails
    When the customer pays with a declined card
    Then the order is confirmed

  Scenario: A page with no step definition
    When the customer opens the gift page
    Then the page is shown

  Scenario: A step that is still pending
    Then a future step is pending

  Scenario: A step that matches two definitions
    Given a step that matches two definitions
