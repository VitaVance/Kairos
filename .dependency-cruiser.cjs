/**
 * Architecture rules, enforced mechanically.
 *
 * Run: pnpm deps:check
 * The onion layering is only real if violations fail CI, so these rules are
 * the executable form of docs/ARCHITECTURE.md.
 */
module.exports = {
  forbidden: [
    {
      name: 'core-is-pure',
      severity: 'error',
      comment:
        'The domain core must not know about React, storage, Tauri, or the network. ' +
        'It declares ports; everything else implements or consumes them.',
      from: { path: '^packages/core' },
      to: {
        pathNot: ['^packages/core', '^node_modules/(typescript|vitest|@types)'],
      },
    },
    {
      name: 'ui-is-presentational',
      severity: 'error',
      comment: 'UI components render props. No feature logic, no services.',
      from: { path: '^packages/ui' },
      to: { path: ['^packages/(features|adapters)', '^apps/'] },
    },
    {
      name: 'features-no-adapters',
      severity: 'error',
      comment:
        'Feature screens talk to services, never to storage adapters or the host shell. ' +
        'This is what lets the same screens run on desktop and mobile.',
      from: { path: '^packages/features' },
      to: { path: ['^packages/adapters', '^apps/'] },
    },
    {
      name: 'adapters-no-ui',
      severity: 'error',
      comment: 'Persistence adapters must not depend on presentation.',
      from: { path: '^packages/adapters' },
      to: { path: ['^packages/(ui|features)', '^apps/', '^react'] },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular imports make the layering unverifiable.',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(node_modules|\\.test\\.tsx?$)' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require', 'node', 'default'] },
    reporterOptions: { dot: { collapsePattern: 'node_modules/[^/]+' } },
  },
};
