@cart
Feature: Cart
  The cart keeps what the customer chose.

  @smoke
  Scenario: Add a book
    Given a cart with a book
    Then the cart shows one item
