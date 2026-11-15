// Fictional Testmo data for the demo instance; nothing here refers to a real company, product or person.
const gherkin = (text) => `<pre><code class="editor-gherkin language-gherkin code-block">${text.trim().replace(/</g, '&lt;')}</code></pre>`;
const steps = (rows) => rows.map(([step, expected], i) => ({ display_order: i + 1, text1: `<p>${step}</p>`, text3: expected ? `<p>${expected}</p>` : '' }));
const daysAgo = (d, h = 10) => {
  const t = new Date();
  t.setDate(t.getDate() - d);
  t.setHours(h, 0, 0, 0);
  return t.toISOString().slice(0, 19).replace('T', ' ');
};

export function buildData() {
  const users = [
    { id: 7, name: 'Alex Rivera', email: 'alex.rivera@example.com' },
    { id: 8, name: 'Priya Natarajan', email: 'priya.natarajan@example.com' },
    { id: 9, name: 'Jonas Weber', email: 'jonas.weber@example.com' },
  ];
  const me = users[0];

  const projects = [
    { id: 1, name: 'Summit Outfitters – Web Store', is_completed: false, created_at: daysAgo(400) },
    { id: 2, name: 'Summit Outfitters – Mobile App', is_completed: false, created_at: daysAgo(300) },
    { id: 3, name: 'Legacy storefront (archived)', is_completed: true, created_at: daysAgo(900) },
  ];

  const statuses = [
    { id: 1, name: 'Untested', color: '#c8c9ca', is_untested: true },
    { id: 2, name: 'Passed', color: '#16a34a', is_untested: false },
    { id: 3, name: 'Failed', color: '#dc2626', is_untested: false },
    { id: 4, name: 'Retest', color: '#f59e0b', is_untested: false },
    { id: 5, name: 'Blocked', color: '#7c3aed', is_untested: false },
    { id: 6, name: 'Skipped', color: '#64748b', is_untested: false },
  ];

  const milestones = [
    { id: 31, project_id: 1, name: 'Release 3.1', is_completed: true, start_date: daysAgo(35, 0).slice(0, 10), created_at: daysAgo(40) },
    { id: 32, project_id: 1, name: 'Release 3.2', is_completed: false, start_date: daysAgo(7, 0).slice(0, 10), created_at: daysAgo(9) },
    { id: 33, project_id: 2, name: 'iOS 2.4', is_completed: false, start_date: daysAgo(5, 0).slice(0, 10), created_at: daysAgo(6) },
  ];

  const folders = [
    { id: 10, project_id: 1, name: 'Cart' },
    { id: 11, project_id: 1, name: 'Checkout' },
    { id: 12, project_id: 1, name: 'Account' },
    { id: 13, project_id: 1, name: 'Search & navigation' },
    { id: 14, project_id: 1, name: 'Discounts & promotions' },
    { id: 20, project_id: 2, name: 'Onboarding' },
  ];

  const fields = [
    { id: 1, name: 'Preconditions', system_name: 'preconditions', column_name: 'custom_preconditions', type: 'text' },
    { id: 2, name: 'Steps', system_name: 'steps', column_name: 'custom_steps', type: 'steps' },
    { id: 3, name: 'Scenario', system_name: 'bdd_scenario', column_name: 'custom_scenario', type: 'text' },
    { id: 4, name: 'Priority', system_name: 'priority', column_name: 'custom_priority', type: 'dropdown' },
  ];
  const priorityOptions = [
    { id: 1, value: 'Low' },
    { id: 2, value: 'Medium' },
    { id: 3, value: 'High' },
    { id: 4, value: 'Critical' },
  ];
  const templates = [
    {
      id: 1,
      name: 'Test case (steps)',
      fields: [
        { id: 4, name: 'Priority', system_name: 'priority', type: 8, options: priorityOptions },
        { id: 1, name: 'Preconditions', system_name: 'preconditions', type: 2 },
        { id: 2, name: 'Steps', system_name: 'steps', type: 10 },
      ],
    },
    {
      id: 2,
      name: 'BDD scenario (Gherkin)',
      fields: [
        { id: 4, name: 'Priority', system_name: 'priority', type: 8, options: priorityOptions },
        { id: 3, name: 'Scenario', system_name: 'bdd_scenario', type: 2 },
      ],
    },
  ];
  const prio = (id) => ({ id, name: priorityOptions.find((o) => o.id === id).value });

  const cases = [
    {
      id: 1001, project_id: 1, folder_id: 10, template_id: 1, name: 'Add a product to the cart from the catalog', created_at: daysAgo(60),
      custom_priority: prio(3),
      custom_preconditions: '<p>Catalog page is open and the cart is empty.</p>',
      custom_steps: steps([
        ['Open the catalog page.', 'At least six products are listed with a price and an <strong>Add to cart</strong> button.'],
        ['Click <strong>Add to cart</strong> on "Ridgeline 2P Tent".', 'The cart badge in the header shows 1.'],
        ['Open the cart.', 'The tent is listed once with quantity 1 and the subtotal matches its price.'],
      ]),
    },
    {
      id: 1002, project_id: 1, folder_id: 10, template_id: 1, name: 'Update item quantity in the cart', created_at: daysAgo(60),
      custom_priority: prio(2),
      custom_preconditions: '<p>One item is in the cart.</p>',
      custom_steps: steps([
        ['Change the quantity of the item to 3.', 'The line total and the subtotal update without a page reload.'],
        ['Change the quantity to 0.', 'The item is removed and the empty-cart message is shown.'],
      ]),
    },
    {
      id: 1003, project_id: 1, folder_id: 10, template_id: 2, name: 'Remove an item from the cart', created_at: daysAgo(58),
      custom_priority: prio(2),
      custom_scenario: gherkin(`
Scenario: Remove the only item
  Given the cart contains "Ridgeline 2P Tent"
  When I click "Remove" on that line
  Then the cart is empty
  And the header badge is hidden`),
    },
    {
      id: 1004, project_id: 1, folder_id: 14, template_id: 2, name: 'Apply a percentage discount code at checkout', created_at: daysAgo(30),
      custom_priority: prio(4),
      custom_scenario: gherkin(`
@checkout @discounts
Scenario: A valid percentage code reduces the order total
  Given my cart contains "Ridgeline 2P Tent" priced at 249.00
  And I am on the cart page
  When I enter the discount code "SAVE10"
  And I click "Apply"
  Then I see the message "Discount applied"
  And the discount line shows -24.90
  And the order total is 224.10`),
    },
    {
      id: 1005, project_id: 1, folder_id: 14, template_id: 2, name: 'Reject an expired discount code', created_at: daysAgo(30),
      custom_priority: prio(3),
      custom_scenario: gherkin(`
Scenario: Expired code is rejected with a clear message
  Given I am on the cart page with one item
  When I enter the discount code "SUMMER24"
  And I click "Apply"
  Then I see the error "This code has expired"
  And the order total is unchanged`),
    },
    {
      id: 1006, project_id: 1, folder_id: 14, template_id: 2, name: 'Free shipping is applied above the threshold', created_at: daysAgo(30),
      custom_priority: prio(2),
      custom_scenario: gherkin(`
Scenario Outline: Shipping cost depends on the subtotal
  Given my cart subtotal is <subtotal>
  When I open the cart page
  Then the shipping line shows <shipping>

  Examples:
    | subtotal | shipping |
    | 49.00    | 6.95     |
    | 75.00    | Free     |
    | 120.00   | Free     |`),
    },
    {
      id: 1007, project_id: 1, folder_id: 11, template_id: 1, name: 'Guest checkout with a credit card', created_at: daysAgo(55),
      custom_priority: prio(4),
      custom_preconditions: '<p>Cart contains one item. Not signed in.</p>',
      custom_steps: steps([
        ['Open the cart and click <strong>Checkout</strong>.', 'The checkout form opens with empty contact and shipping fields.'],
        ['Fill in name, email and a shipping address. Choose <strong>Standard</strong> shipping.', 'The order summary shows the shipping cost.'],
        ['Enter the test card 4242 4242 4242 4242, any future expiry, any CVC. Click <strong>Place order</strong>.', 'The confirmation page shows an order number and the items ordered.'],
      ]),
    },
    {
      id: 1008, project_id: 1, folder_id: 11, template_id: 1, name: 'Validation messages for required address fields', created_at: daysAgo(55),
      custom_priority: prio(2),
      custom_steps: steps([
        ['Open the checkout form and click <strong>Place order</strong> without filling anything in.', 'Every required field shows an inline error and the first one receives focus.'],
        ['Fill in the name only and submit again.', 'Only the remaining empty fields are marked.'],
      ]),
    },
    {
      id: 1009, project_id: 1, folder_id: 11, template_id: 2, name: 'Order confirmation shows the order number and summary', created_at: daysAgo(50),
      custom_priority: prio(3),
      custom_scenario: gherkin(`
Scenario: Confirmation page after a successful order
  Given I have placed an order with two items
  Then I see an order number in the format "SO-" followed by 6 digits
  And I see both items with their quantities
  And I see the total I was charged`),
    },
    {
      id: 1010, project_id: 1, folder_id: 11, template_id: 2, name: 'Shipping method changes the order total', created_at: daysAgo(50),
      custom_priority: prio(2),
      custom_scenario: gherkin(`
Scenario: Switching to express shipping
  Given I am on the checkout page with a 49.00 subtotal
  When I select "Express (1–2 days)"
  Then the shipping line shows 14.95
  And the order total is 63.95`),
    },
    {
      id: 1011, project_id: 1, folder_id: 12, template_id: 1, name: 'Returning customer signs in during checkout', created_at: daysAgo(45),
      custom_priority: prio(3),
      custom_preconditions: '<p>A customer account exists with a saved address.</p>',
      custom_steps: steps([
        ['From the checkout page click <strong>Sign in</strong> and enter valid credentials.', 'The checkout page reloads with the customer name shown in the header.'],
        ['Look at the shipping section.', 'The saved address is prefilled.'],
      ]),
    },
    {
      id: 1012, project_id: 1, folder_id: 12, template_id: 2, name: 'Saved address is preselected for signed-in customers', created_at: daysAgo(45),
      custom_priority: prio(2),
      custom_scenario: gherkin(`
Scenario: Default address is selected
  Given I am signed in as a customer with two saved addresses
  When I open the checkout page
  Then the address marked "Default" is selected
  And I can switch to the other address without retyping it`),
    },
    { id: 1013, project_id: 1, folder_id: 13, template_id: 1, name: 'Search returns matching products', created_at: daysAgo(20), custom_priority: prio(3), custom_steps: steps([['Search for "tent".', 'Only tents are listed.']]) },
    { id: 1014, project_id: 1, folder_id: 13, template_id: 1, name: 'Filter by category and price range', created_at: daysAgo(20), custom_priority: prio(2), custom_steps: steps([['Select the "Sleeping bags" category and the 50–150 price range.', 'Only matching products remain and the result count updates.']]) },
    { id: 1015, project_id: 1, folder_id: 13, template_id: 1, name: 'Empty search shows suggestions', created_at: daysAgo(20), custom_priority: prio(1), custom_steps: steps([['Search for "xyzzy".', 'A "no results" message with popular categories is shown.']]) },
    { id: 1016, project_id: 1, folder_id: 12, template_id: 1, name: 'Password reset email is sent', created_at: daysAgo(18), custom_priority: prio(3), custom_steps: steps([['Request a reset for a known address.', 'A confirmation message is shown and the email arrives within a minute.']]) },
    { id: 1017, project_id: 1, folder_id: 12, template_id: 1, name: 'Sign in with valid credentials', created_at: daysAgo(18), custom_priority: prio(4), custom_steps: steps([['Sign in with a valid email and password.', 'The account page opens.']]) },
    { id: 2001, project_id: 2, folder_id: 20, template_id: 1, name: 'First launch shows the welcome carousel', created_at: daysAgo(15), custom_priority: prio(2), custom_steps: steps([['Install and open the app.', 'Three welcome screens can be swiped through.']]) },
  ];

  const runs = [
    { id: 201, project_id: 1, milestone_id: 32, name: 'Checkout regression – Release 3.2', is_closed: false, created_at: daysAgo(3, 9), case_ids: [1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010, 1011, 1012] },
    { id: 202, project_id: 1, milestone_id: 32, name: 'Account & sign-in smoke', is_closed: false, created_at: daysAgo(4, 11), case_ids: [1011, 1012, 1016, 1017] },
    { id: 203, project_id: 1, milestone_id: 32, name: 'Search and filters', is_closed: false, created_at: daysAgo(2, 14), case_ids: [1013, 1014, 1015] },
    { id: 204, project_id: 1, milestone_id: null, name: 'Exploratory – new cart drawer', is_closed: false, created_at: daysAgo(1, 16), case_ids: [1001, 1002, 1003] },
    { id: 190, project_id: 1, milestone_id: 31, name: 'Release 3.1 – final regression', is_closed: true, created_at: daysAgo(36, 9), case_ids: [1001, 1002, 1003, 1007, 1008] },
    { id: 301, project_id: 2, milestone_id: 33, name: 'Onboarding smoke', is_closed: false, created_at: daysAgo(2, 9), case_ids: [2001] },
  ];

  // Run tests: one per (run, case). Ids are deliberately non-contiguous.
  const tests = [];
  let testId = 5000;
  for (const run of runs) {
    for (const caseId of run.case_ids) {
      testId += 1 + ((caseId * 7) % 3);
      tests.push({ id: testId, run_id: run.id, case_id: caseId, assignee_id: null });
    }
  }
  const testFor = (runId, caseId) => tests.find((t) => t.run_id === runId && t.case_id === caseId);

  // Assign the discount and checkout scenarios in run 201 to "me".
  for (const caseId of [1004, 1005, 1006, 1009, 1010]) testFor(201, caseId).assignee_id = me.id;

  const results = [];
  let resultId = 9000;
  const addResult = (runId, caseId, statusId, note, { by = 8, elapsed = 0, ago = 1, hour = 10, assignee = null } = {}) => {
    const t = testFor(runId, caseId);
    resultId += 1;
    results.push({ id: resultId, run_id: runId, test_id: t.id, case_id: caseId, status_id: statusId, note, elapsed, created_by: by, assignee_id: assignee ?? t.assignee_id, created_at: daysAgo(ago, hour), attachments: [] });
    return results[results.length - 1];
  };
  addResult(201, 1001, 2, '<p>Badge updated immediately, subtotal 249.00 as expected.</p>', { elapsed: 84, ago: 2, hour: 10 });
  addResult(201, 1002, 2, '<p>Quantity 3 → line total 747.00. Setting 0 removes the line.</p>', { elapsed: 132, ago: 2, hour: 10 });
  addResult(201, 1003, 2, '<p>Works, badge hidden when empty.</p>', { elapsed: 61, ago: 2, hour: 11 });
  addResult(201, 1007, 3, '<p>Placing the order with the test card returned a 500 on the first try. Passed on retry.</p><p>Logged as SHOP-1421.</p>', { by: 9, elapsed: 410, ago: 2, hour: 15 });
  addResult(201, 1007, 4, '<p>Backend fix deployed to staging, please retest.</p>', { by: 9, elapsed: 0, ago: 1, hour: 9 });
  addResult(201, 1008, 2, '<p>All four required fields flagged; focus moved to "Full name".</p>', { elapsed: 97, ago: 1, hour: 11 });
  addResult(202, 1016, 2, '<p>Email arrived in 12 s.</p>', { elapsed: 140, ago: 3 });
  addResult(202, 1017, 2, '<p>OK</p>', { elapsed: 40, ago: 3 });
  addResult(202, 1011, 5, '<p>Staging SSO is down (INFRA-88).</p>', { by: 9, ago: 3 });
  for (const caseId of [1001, 1002, 1003, 1007, 1008]) addResult(190, caseId, 2, '<p>Passed in 3.1 final.</p>', { ago: 33 });
  addResult(301, 2001, 2, '<p>OK on iPhone 15 simulator.</p>', { ago: 1 });

  const attachments = []; // { id, name, size, mime, buffer, case_id?, project_id? }

  return { users, me, projects, statuses, milestones, folders, fields, templates, cases, runs, tests, results, attachments, nextIds: { test: testId, result: resultId, case: 1100, attachment: 7000 } };
}
