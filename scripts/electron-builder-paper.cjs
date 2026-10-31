const { build } = require('../package.json')
module.exports = {
  ...build,
  extraResources: [...build.extraResources, { from: 'vendor/tex/cache', to: 'tex-bundles', filter: ['*win32-x64*.mftex.gz'] }],
}
