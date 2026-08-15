import React from 'react';
import { mount } from 'cypress/react18';
import LoginPage from './LoginPage';
import { AuthContext } from '../context/AuthContext'; // import context directly

describe('<LoginPage />', () => {
  it('calls login function on form submission', () => {
    const mockAuthValue = {
      login: cy.stub().as('loginStub'),
      user: null,
      isAuthenticated: false,
    };

    mount(
      <AuthContext.Provider value={mockAuthValue}>
        <LoginPage />
      </AuthContext.Provider>
    );

    // Example assertion
    cy.get('button[type="submit"]').click();
    cy.get('@loginStub').should('have.been.called');
  });
});