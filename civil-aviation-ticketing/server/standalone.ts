import { startServer } from './server';

const licenseDisabled = process.argv.includes('--license-disabled') || process.env.CA_LICENSE_DISABLED_FOR_DEV === 'true';

startServer({ licenseRequired: !licenseDisabled }).then(({ port }) => {
  console.log(`API listening on http://127.0.0.1:${port}`);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
