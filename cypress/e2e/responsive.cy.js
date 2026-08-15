it('displays mobile hamburger menu on mobile screens', () => {
  // Set viewport to iPhone size
  cy.viewport('iphone-x');
  cy.login('admin', 'password');

  // Sidebar should be hidden, hamburger icon visible
  cy.get('button').find('svg').should('be.visible');
  cy.get('button').has('svg').first().click();

  // Mobile sidebar drawer opens
  cy.contains('Dashboard').should('be.visible');
});