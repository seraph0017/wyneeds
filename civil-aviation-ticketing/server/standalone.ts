import { startServer } from './server';

startServer().then(({ port }) => {
  console.log(`API listening on http://127.0.0.1:${port}`);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
