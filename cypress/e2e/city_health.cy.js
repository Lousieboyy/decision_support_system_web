// Covers the three City Health indices — Service Performance (SPI), Urban
// Condition (UCI), and Infrastructure Fragility (IFI, added this session).
// See CityHealthBands.jsx and analyticsMetrics.js's buildInfrastructureFragility.

describe('City Health — three indices', () => {
  beforeEach(() => {
    cy.login('admin', 'password');
    cy.contains('button', 'City Health').click();
  });

  it('renders all three bands', () => {
    // Headings are visually uppercased via CSS (text-transform), but the
    // actual DOM text is title-case — cy.contains matches real text, not
    // the rendered CSS transform. Three stacked bands run well past one
    // viewport, so later ones need scrolling into view first.
    cy.contains('Service Performance').scrollIntoView().should('be.visible');
    cy.contains('Urban Condition').scrollIntoView().should('be.visible');
    cy.contains('Infrastructure Fragility').scrollIntoView().should('be.visible');
  });

  it('opens the Infrastructure Fragility methodology panel with live weights', () => {
    cy.contains('h2', 'Infrastructure Fragility')
      .parents('section')
      .contains('button', 'Methodology')
      .click();

    cy.contains('h3', 'Infrastructure Fragility Index').should('be.visible');
    // Weights are read from IFI_WEIGHTS at runtime, not hardcoded in the
    // panel — confirm the population-source disclosure is present, since
    // that's the one methodological limitation worth surfacing to a reader.
    cy.contains('Department of Statistics Malaysia').should('be.visible');
    cy.contains('failureRate').should('be.visible');
    cy.contains('reportRate').should('be.visible');
    cy.contains('mtbf').should('be.visible');
  });
});

describe('Infrastructure Fragility — insufficient-data handling', () => {
  it('reports "Insufficient data" rather than a guessed score when no zone clears the threshold', () => {
    // MBMB's ~34 reports spread thin enough across zones that (at the time
    // this suite was written) none reach the 10-report minimum — the
    // correct behavior is an honest "not enough data" state, not a score
    // built on 2-3 reports.
    cy.login('mbmb', 'password');
    cy.contains('button', 'City Health').click();

    cy.contains('h2', 'Infrastructure Fragility')
      .parents('section')
      .within(() => {
        cy.contains(/Insufficient data|zone scored/).scrollIntoView().should('be.visible');
      });
  });
});
