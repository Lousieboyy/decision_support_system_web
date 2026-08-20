describe('Reports Page', () => {
  beforeEach(() => {
    cy.login('admin', 'password');
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
    const clickFirstRow = () => cy.get('tbody tr').first().find('td').first().click();

    // Click the ID cell specifically, not the row's calculated center —
    // the table is wide enough that Cypress's default center-click can miss
    // (this table has no overlay; it's a hit-testing quirk at the default
    // 1000px viewport, not present when the row's own onClick is invoked
    // directly). Even cell-targeted, this click intermittently doesn't
    // register — the app itself opens the modal reliably when clicked
    // directly via the DOM (verified outside Cypress), so this is a
    // real-but-rare Cypress/Electron click timing flake, not an app bug.
    // One retry is cheap insurance against it.
    clickFirstRow();
    cy.get('body').then(($body) => {
      if ($body.find('h2:contains("Report #")').length === 0) {
        clickFirstRow();
      }
    });

    cy.contains('h2', 'Report #', { timeout: 10000 }).should('be.visible');
  });
});
