describe('Responsive layout', () => {
  it('displays mobile hamburger menu on mobile screens', () => {
    // Set viewport to iPhone size
    cy.viewport('iphone-x');
    cy.login('admin', 'password');

    // Sidebar starts closed on mobile (CSS-driven via the "open" class, not
    // conditional rendering — checking visibility of its contents wouldn't
    // prove much since they're always in the DOM).
    cy.get('.sidebar').should('not.have.class', 'open');

    // Hamburger is the only button inside the mobile-only header strip.
    cy.get('.md\\:hidden button').first().click();

    cy.get('.sidebar').should('have.class', 'open');
    // Admin lands on the Insights page, so that's the nav item to expect —
    // "Dashboard" is worker-only and never appears for this login.
    cy.contains('a', 'Insights').should('be.visible');
  });
});
