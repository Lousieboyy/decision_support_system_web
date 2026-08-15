describe('API Intercept & Error Handling', () => {
  it('handles server failure (500 error) gracefully', () => {
    // Intercept reports API request and simulate 500 error
    cy.intercept('GET', '**/reports*', {
      statusCode: 500,
      body: { error: 'Internal Server Error' },
    }).as('getReportsFail');

    // Log in (uses demo password 'password')
    cy.login('admin', 'password');

    // Navigate to Reports
    cy.contains('a', 'Reports').click();

    // Wait for intercepted 500 response
    cy.wait('@getReportsFail');

    // Verify error UI is displayed
    cy.contains('Failed to load reports').should('be.visible');
  });
});