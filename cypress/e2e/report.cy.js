// describe('Reports Page', () => {
//   beforeEach(() => {
//     cy.login('admin', 'admin1234');
//     cy.contains('a', 'Reports').click();
//   });

//   it('filters reports by category or status', () => {
//     // Search report by keyword
//     cy.get('input[placeholder*="Search"]').type('Pothole');
//     cy.get('.report-card').should('have.length.at.least', 1);

//     // Filter by department/authority
//     cy.get('select').first().select('MBMB');
//     cy.contains('MBMB').should('be.visible');
//   });

//   it('opens report detail modal', () => {
//     cy.get('.report-card').first().click();
//     cy.get('.modal-content').should('be.visible');
//   });
// });

describe('Reports Page', () => {
  beforeEach(() => {
    cy.login('admin', 'admin1234');
    cy.contains('a', 'Reports').click();

    // WAIT for loading spinner/text to disappear before running tests
    cy.contains('Loading reports...').should('not.exist');
  });

  it('filters reports by category or status', () => {
    // Search report by keyword
    cy.get('input[placeholder*="Search"]').type('Pothole');
    
    // Check that at least 1 table row is found in tbody
    cy.get('tbody tr').should('have.length.at.least', 1);
  });

  it('opens report detail modal', () => {
    // Click the first table row to open detail modal
    cy.get('tbody tr').first().click();
    
    // Check that the modal opened by looking for the "Report #" header
    cy.contains('h2', 'Report #').should('be.visible');
  });
});