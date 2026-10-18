const revision = typeof __PL_BUILD_REVISION__ === 'string' ? __PL_BUILD_REVISION__ : 'unknown';
const release = typeof __PL_RELEASE_BUILD__ === 'boolean' && __PL_RELEASE_BUILD__;
export const BUILD_IDENTITY = release ? ` (${revision})` : `-dev (${revision})`;
