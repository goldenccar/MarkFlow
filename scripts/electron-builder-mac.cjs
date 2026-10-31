const { build } = require('../package.json')
module.exports = {
  ...build,
  extraResources: [{ from: 'vendor/tex/cache', to: 'tex-bundles', filter: ['*darwin-*.mftex.gz'] }],
  mac: { target: ['dmg'], minimumSystemVersion: '13.0', category: 'public.app-category.productivity' },
}
