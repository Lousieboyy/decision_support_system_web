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
    cy.login('admin', 'password');
    cy.contains('a', 'Users').click();

    // Approving doesn't render the word "Approved" anywhere on this page —
    // the row just leaves the Pending Requests list, and the account's
    // status column reads "Active" (DBStaff.status, not "approved") once
    // you switch to All Accounts.
    cy.contains(newUsername).parents('tr').contains('button', 'Approve').click();
    cy.contains(newUsername).should('not.exist');

    cy.contains('button', 'All Accounts').click();
    // The status column sits past the table's horizontal scroll at this
    // viewport width — scroll it into view rather than asserting existence
    // alone, so this still catches a real rendering regression.
    cy.contains(newUsername).parents('tr').contains('Active').scrollIntoView().should('be.visible');
  });
});