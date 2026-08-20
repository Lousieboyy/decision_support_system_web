// Covers the role-scoped Reports table (worker/authority/admin see
// different status tabs and columns) and the worker's personal Dashboard —
// both built to fix the "worker sees dept-wide clutter they can't act on"
// complaint. See ReportsPage.jsx's viewMode logic and DashboardPage.jsx's
// isWorker branch.

describe('Role-scoped Reports page', () => {
  it('worker sees only their actionable tabs and a trimmed column set', () => {
    cy.login('worker1', 'password');
    cy.contains('a', 'Reports').click();
    cy.contains('Loading reports...').should('not.exist');

    cy.contains('button', 'In Process').should('be.visible');
    cy.contains('button', 'In Maintenance').should('be.visible');
    cy.contains('button', 'Resolved').should('be.visible');

    // Pending/In Review/Rejected/All are admin-only decisions — a worker
    // never acts on them, so the tab shouldn't exist at all.
    cy.contains('button', 'Pending').should('not.exist');
    cy.contains('button', 'In Review').should('not.exist');
    cy.contains('button', 'Rejected').should('not.exist');
    cy.contains('button', 'All').should('not.exist');

    cy.get('thead').within(() => {
      cy.contains('Image').should('not.exist');
      cy.contains('AI Prediction').should('not.exist');
      cy.contains('Upvotes').should('not.exist');
    });
  });

  it('authority sees In Review plus a Team & Crew column instead of a redundant dept tag', () => {
    cy.login('mbmb', 'password');
    cy.contains('a', 'Reports').click();
    cy.contains('Loading reports...').should('not.exist');

    cy.contains('button', 'In Review').should('be.visible');
    cy.contains('button', 'Pending').should('not.exist');
    cy.contains('button', 'Rejected').should('not.exist');

    cy.get('thead').contains('Team & Crew').should('be.visible');
  });

  it('admin keeps the full tab set and every column', () => {
    cy.login('admin', 'password');
    cy.contains('a', 'Reports').click();
    cy.contains('Loading reports...').should('not.exist');

    ['Open', 'Pending', 'In Review', 'In Process', 'In Maintenance', 'Resolved', 'Rejected', 'All']
      .forEach((tab) => cy.contains('button', tab).should('be.visible'));

    // Admin's table is the widest (10 columns) and runs past the test
    // viewport, so later columns sit behind the table's own horizontal
    // scroll — scroll each into view before asserting visibility.
    cy.get('thead').within(() => {
      cy.contains('Image').scrollIntoView().should('be.visible');
      cy.contains('AI Prediction').scrollIntoView().should('be.visible');
      cy.contains('Assigned To').scrollIntoView().should('be.visible');
      cy.contains('Upvotes').scrollIntoView().should('be.visible');
    });
  });
});

describe("Worker's personal Dashboard", () => {
  it('shows the worker their own job stats, not department-wide charts', () => {
    cy.login('worker1', 'password');

    cy.contains('h1', 'My Workflow').should('be.visible');
    cy.contains('My Active Jobs').should('be.visible');
    cy.contains('Waiting In Pool').should('be.visible');
    cy.contains('My Resolved').should('be.visible');
    cy.contains('My Total Jobs').should('be.visible');
    cy.contains('My Jobs').should('be.visible');

    // City/department-wide trend charts belong to admin & authority's
    // Analytics page, not a worker's operational dashboard.
    cy.contains('Reports Over Time').should('not.exist');
    cy.contains('By Category').should('not.exist');
    cy.contains('Status Breakdown').should('not.exist');
  });
});
