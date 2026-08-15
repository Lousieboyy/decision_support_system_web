// ***********************************************
// This example commands.js shows you how to
// create various custom commands and overwrite
// existing commands.
//
// For more comprehensive examples of custom
// commands please read more here:
// https://on.cypress.io/custom-commands
// ***********************************************
//
//
// -- This is a parent command --
// Cypress.Commands.add('login', (email, password) => { ... })
//
//
// -- This is a child command --
// Cypress.Commands.add('drag', { prevSubject: 'element'}, (subject, options) => { ... })
//
//
// -- This is a dual command --
// Cypress.Commands.add('dismiss', { prevSubject: 'optional'}, (subject, options) => { ... })
//
//
// -- This will overwrite an existing command --
// Cypress.Commands.overwrite('visit', (originalFn, url, options) => { ... })

// // cypress/support/commands.js
// Cypress.Commands.add('login', (username = 'admin', password = 'admin1234') => {
//   cy.visit('/login');
//   cy.get('input[type="text"]').type(username);
//   cy.get('input[type="password"]').type(password);
//   cy.get('button[type="submit"]').click();
//   cy.url().should('eq', `${Cypress.config('baseUrl')}/`);
// });

// cypress/support/commands.js
Cypress.Commands.add('login', (username = 'admin', password = 'password') => {
  // Clear localStorage before React scripts initialize
  cy.visit('/', {
    onBeforeLoad(win) {
      win.localStorage.clear();
    },
  });

  // Target the username input field by its placeholder
  cy.get('input[placeholder*="admin"]').should('be.visible').clear().type(username);
  cy.get('input[type="password"]').clear().type(password);
  cy.get('button[type="submit"]').click();

  // Verify login succeeded and navigated away from /login
  cy.url().should('not.include', '/login');
});