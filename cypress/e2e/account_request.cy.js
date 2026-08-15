describe('Account Request & Admin Workflow', () => {
  const newUsername = `testuser_${Date.now()}`;

  it('submits a new account access request', () => {
    cy.visit('/login');
    cy.contains('button', 'Request Access').click();

    cy.get('input[placeholder="e.g. Ahmad bin Razak"]').type('Test Worker');
    cy.get('input[placeholder="e.g. ahmad_mbmb"]').type(newUsername);
    cy.get('input[type="password"]').type('password123');
    cy.get('button[type="submit"]').click();

    cy.contains('Request sent! An admin will review').should('be.visible');
  });

  it('admin approves the new account in User Management', () => {
    cy.login('admin', 'admin1234');
    cy.contains('User Management').click();

    // Verify pending user request appears and approve it
    cy.contains(newUsername).parents('tr').contains('button', 'Approve').click();
    cy.contains('Approved').should('be.visible');
  });
});