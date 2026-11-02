// Vercel entry: every request is rewritten here (see vercel.json) and handled
// by the Express app. dist/ is compiled by `npm run build` (tsc + tsc-alias)
// before Vercel bundles this function. Local/Docker runs use src/server.ts.
const { createApp } = require('../dist/app');

module.exports = createApp();
