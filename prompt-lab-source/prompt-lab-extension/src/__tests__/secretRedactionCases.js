// Obviously fake credentials. Shared by the engine table and the highlight
// Enhance path so both reject the same strings.

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlMTIzNDU2';

function key(name, value) {
  return [name, `use ${value} please`, `use API_KEY please`, value];
}

function pem(kind) {
  const block = `-----BEGIN ${kind}-----\nFAKEFAKEFAKEFAKE\n-----END ${kind}-----`;
  return [`PEM ${kind}`, `before\n${block}\nafter`, 'before\nAPI_KEY\nafter', 'FAKEFAKEFAKEFAKE'];
}

const longLegacyKey = `sk-${'b'.repeat(180)}`;

export const SECRET_REDACTION_CASES = [
  key('Anthropic sk-ant-api03 key', 'sk-ant-api03-FAKEFAKEFAKEFAKEFAKE'),
  key('Anthropic sk-ant-admin01 key', 'sk-ant-admin01-FAKEFAKEFAKEFAKEFAKE'),
  key('Anthropic sk-ant key', 'sk-ant-FAKE_FAKE-FAKEFAKEFAKE'),
  key('OpenAI sk-proj key', 'sk-proj-FAKE_FAKE-FAKEFAKEFAKE'),
  key('OpenAI sk-svcacct key', 'sk-svcacct-FAKEFAKEFAKEFAKEFAKE'),
  key('OpenAI sk-admin key', 'sk-admin-FAKEFAKEFAKEFAKEFAKE'),
  key('GitHub fine-grained pat', 'github_pat_FAKEFAKEFAKEFAKEFAKE11_FAKEFAKEFAKEFAKEFAKE'),
  key('GitHub ghp token', 'ghp_FAKEFAKEFAKEFAKEFAKE'),
  key('GitHub gho token', 'gho_FAKEFAKEFAKEFAKEFAKE'),
  key('GitHub ghu token', 'ghu_FAKEFAKEFAKEFAKEFAKE'),
  key('GitHub ghs token', 'ghs_FAKEFAKEFAKEFAKEFAKE'),
  key('GitHub ghr token', 'ghr_FAKEFAKEFAKEFAKEFAKE'),
  key('Stripe sk_live key', 'sk_live_FAKEFAKEFAKE'),
  key('Stripe sk_test key', 'sk_test_FAKEFAKEFAKE'),
  key('Stripe rk_live key', 'rk_live_FAKEFAKEFAKE'),
  key('Stripe rk_test key', 'rk_test_FAKEFAKEFAKE'),
  key('Stripe webhook secret', 'whsec_FAKEFAKEFAKE'),
  key('Slack xoxa token', 'xoxa-FAKEFAKE-FAKEFAKE'),
  key('Slack xoxb token', 'xoxb-FAKEFAKE-FAKEFAKE'),
  key('Slack xoxp token', 'xoxp-FAKEFAKE-FAKEFAKE'),
  key('Slack xoxr token', 'xoxr-FAKEFAKE-FAKEFAKE'),
  key('Slack xoxs token', 'xoxs-FAKEFAKE-FAKEFAKE'),
  key('AWS access key id', 'AKIAFAKEFAKEFAKEFAKE'),
  key('Google API key', 'AIzaFAKE-FAKE_FAKEFAKEFAKE'),
  ['standalone JWT', `see ${JWT} here`, 'see API_KEY here', JWT],
  ['uncapped legacy sk key', `key ${longLegacyKey} tail`, 'key API_KEY tail', longLegacyKey],
  pem('RSA PRIVATE KEY'),
  pem('OPENSSH PRIVATE KEY'),
  pem('EC PRIVATE KEY'),
  pem('PRIVATE KEY'),
  ['env stripe secret', 'STRIPE_SECRET_KEY=sk_live_FAKEFAKEFAKE', 'STRIPE_SECRET_KEY=API_KEY', 'sk_live_FAKEFAKEFAKE'],
  ['env openai key', 'OPENAI_API_KEY=sk-proj-FAKEFAKEFAKEFAKEFAKE', 'OPENAI_API_KEY=API_KEY', 'sk-proj-FAKEFAKEFAKEFAKEFAKE'],
  ['exported aws secret', 'export AWS_SECRET_ACCESS_KEY=FAKE/FAKE+FAKE=', 'export AWS_SECRET_ACCESS_KEY=SECRET', 'FAKE/FAKE+FAKE='],
  ['env password with spaces', 'MY_PASSWORD=correct horse battery staple', 'MY_PASSWORD=SECRET', 'correct horse battery staple'],
  ['quoted env password', 'MY_PASSWORD="correct horse battery staple"', 'MY_PASSWORD="SECRET"', 'correct horse battery staple'],
  ['single-quoted env token', "API_TOKEN='correct horse battery staple'", "API_TOKEN='SECRET'", 'correct horse battery staple'],
  ['indented export', '  export OPENAI_API_KEY=sk-proj-FAKEFAKEFAKEFAKEFAKE', '  export OPENAI_API_KEY=API_KEY', 'sk-proj-FAKEFAKEFAKEFAKEFAKE'],
  ['dsn keeps the password off the wire', 'DB_DSN=User ID=app;Password=correct horse battery staple', 'DB_DSN=SECRET_2;Password=SECRET', 'correct horse battery staple'],
  ['database url userinfo', 'DATABASE_URL=postgres://user:pass@localhost/app', 'DATABASE_URL=postgres://SECRET@localhost/app', 'user:pass'],
  ['url userinfo in a sentence', 'Connect to postgres://app:s3cret-pass@db.internal/app today.', 'Connect to postgres://SECRET@db.internal/app today.', 's3cret-pass'],
  ['unquoted multi-word password', 'password: correct horse battery staple', 'password: SECRET', 'correct horse battery staple'],
  ['unquoted passphrase keeps the period', 'password: correct horse battery staple.', 'password: SECRET.', 'correct horse battery staple'],
  ['later assignment after a short password', 'password: short and token: mnopqrstuvwx', 'password: short and token: SECRET', 'mnopqrstuvwx'],
  ['space-separated api key label', 'api key: abcdefghijklmnop', 'API_KEY', 'abcdefghijklmnop'],
  ['space-separated secret key label', 'note secret key: abcdefghijklmnop end', 'note API_KEY end', 'abcdefghijklmnop'],
];

export const PROSE_KEPT_CASES = [
  'Never share your password: it is private.',
  'The password must be at least 12 characters long.',
  'Use a strong password and rotate the token regularly.',
  'The token for the meeting is on the desk.',
  'See the private key ceremony before the talk.',
  'password: short',
  'password: {{db_password}}',
  'Set the password = $DB_PASSWORD_PROD before deploying.',
  'OPENAI_API_KEY=$OPENAI_API_KEY',
  'OPENAI_API_KEY=${OPENAI_API_KEY}',
  'AUTHOR=Jane Doe wrote the guide.',
  'MONKEY_PATCH=somevaluehere',
  'https://example.com/docs and http://localhost:8080/health',
];
