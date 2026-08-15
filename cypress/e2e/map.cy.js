describe('Map Page', () => {
  beforeEach(() => {
    cy.login('admin', 'admin1234');
    cy.contains('a', 'Map').click();
  });

  it('loads Leaflet map container and markers', () => {
    // Verify leaflet map container is mounted
    cy.get('.leaflet-container').should('be.visible');

    // Toggle heatmap / cluster views if present
    cy.contains('button', 'Heatmap').click();
    cy.get('.leaflet-heatmap-layer').should('exist');
  });
});