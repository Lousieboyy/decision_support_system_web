describe('API Intercept & Error Handling', () => {
  it('handles server failure (500 error) gracefully', () => {
    // Intercept only the actual reports API call. A broad glob like
    // '**/reports*' also matches the /src/api/reportsApi.js module file
    // Vite serves in dev mode ('*' matches "Api.js" too) — intercepting
    // that returns JSON where the browser expects JavaScript, which breaks
    // module loading and blanks the entire app before the login page can
    // even render. Anchoring to "/api/reports" followed by "?" or end-of-
    // string excludes the module file (which continues with "Api.js").
    cy.intercept('GET', /\/api\/reports(\?|$)/, {
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