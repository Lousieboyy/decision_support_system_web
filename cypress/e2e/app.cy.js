describe('Decision Support System - E2E Test Suite', () => {
  beforeEach(() => {
    // Visit the home page (redirects to /login if unauthenticated)
    cy.visit('/');
  });

  describe('Authentication Flow', () => {
    it('redirects unauthenticated users to the Login page', () => {
      cy.url().should('include', '/login');
      cy.contains('h1', 'DECISION SUPPORT SYSTEM').should('be.visible');
    });

    it('shows error validation when submitting empty login fields', () => {
      cy.get('button[type="submit"]').click();
      cy.contains('Please fill in all fields.').should('be.visible');
    });

    it('toggles between Sign In and Request Access tabs', () => {
      // Click "Request Access" tab
      cy.contains('button', 'Request Access').click();
      cy.contains('h2', 'Request Account Access').should('be.visible');
      cy.get('input[placeholder="e.g. Ahmad bin Razak"]').should('be.visible');

      // Switch back to "Sign In" tab
      cy.contains('button', 'Sign In').click();
      cy.contains('h2', 'Welcome back').should('be.visible');
    });

    it('shows error on invalid credentials', () => {
      cy.get('input[type="text"]').type('wronguser');
      cy.get('input[type="password"]').type('wrongpassword');
      cy.get('button[type="submit"]').click();

      cy.contains('Invalid username or password').should('be.visible');
    });

    it('logs in successfully with admin demo credentials', () => {
      // Enter demo admin credentials
      cy.get('input[type="text"]').type('admin');
      cy.get('input[type="password"]').type('password');
      cy.get('button[type="submit"]').click();

      // Admin/authority land on the Analytics page (App.jsx's HomeRoute) —
      // DashboardPage is worker-only, so "Dashboard" text never appears here.
      cy.url().should('eq', `${Cypress.config('baseUrl')}/`);
      cy.contains('Infrastructure Analytics').should('be.visible');
    });
  });

  describe('Navigation & Dashboard Flow (Authenticated)', () => {
    beforeEach(() => {
      // Log in before each test in this block
      cy.get('input[type="text"]').type('admin');
      cy.get('input[type="password"]').type('password');
      cy.get('button[type="submit"]').click();
      cy.url().should('eq', `${Cypress.config('baseUrl')}/`);
    });

    it('navigates to the Interactive Map page', () => {
      cy.contains('a', 'Map View').click();
      cy.url().should('include', '/map');
    });

    it('navigates to Reports and Analytics pages', () => {
      // Navigate to Reports
      cy.contains('a', 'Reports').click();
      cy.url().should('include', '/reports');

      // Analytics has no dedicated sidebar link for admin (it's what "Insights"
      // at "/" already shows), but the route itself still exists directly.
      cy.visit('/analytics');
      cy.contains('Infrastructure Analytics').should('be.visible');
    });

    it('logs out successfully', () => {
      // Click logout button in sidebar
      cy.contains('button', 'Logout').click();

      // Verify returned to login screen
      cy.url().should('include', '/login');
      cy.contains('Welcome back').should('be.visible');
    });
  });
});