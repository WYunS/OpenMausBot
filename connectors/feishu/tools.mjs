/* eslint-disable no-control-regex -- Tool text must reject control characters while allowing tabs/newlines. */
// Tagged contracts (commit 2aebe8970f0a472dfc864b6ac3d19d080e75041f):
// https://github.com/larksuite/cli/blob/v1.0.93/shortcuts/doc/docs_create_v2.go
// https://github.com/larksuite/cli/blob/v1.0.93/shortcuts/doc/docs_fetch_v2.go
// https://github.com/larksuite/cli/blob/v1.0.93/shortcuts/calendar/calendar_agenda.go
// https://github.com/larksuite/cli/blob/v1.0.93/shortcuts/calendar/calendar_create.go
// https://github.com/larksuite/cli/blob/v1.0.93/shortcuts/im/im_messages_send.go
// Only plain text is authored: CLI Markdown/XML media expansion can read files or fetch URLs.
const text = (maxLength) => ({ type: 'string', minLength: 1, maxLength });
const token = { ...text(256), pattern: '^[A-Za-z0-9_-]+$' };
const calendarId = { ...text(256), pattern: '^[A-Za-z0-9_.@-]+$' };
const time = { ...text(32), pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2})?(Z|[+-]\\d{2}:\\d{2})$' };
const uuid = { ...text(50), pattern: '^[A-Za-z0-9_-]+$' };

const definitions = [
  ['feishu_document_read', '\u8bfb\u53d6\u98de\u4e66\u6587\u6863', false,
    { documentId: token }, ['documentId']],
  ['feishu_document_create', '\u521b\u5efa\u7eaf\u6587\u672c\u98de\u4e66\u6587\u6863', true,
    { title: text(200), text: text(12000) }, ['title', 'text']],
  ['feishu_calendar_list', '\u5217\u51fa\u6307\u5b9a\u65f6\u95f4\u8303\u56f4\u7684\u65e5\u7a0b', false,
    { calendarId, start: time, end: time }, ['calendarId', 'start', 'end']],
  ['feishu_calendar_event_create', '\u521b\u5efa\u65e5\u7a0b\uff08\u542b\u89c6\u9891\u4f1a\u8bae\u548c\u63d0\u524d\u4e94\u5206\u949f\u63d0\u9192\uff09', true,
    { calendarId, summary: text(200), start: time, end: time }, ['calendarId', 'summary', 'start', 'end']],
  ['feishu_user_send', '\u4ee5\u7528\u6237\u8eab\u4efd\u53d1\u9001\u7eaf\u6587\u672c\u79c1\u4fe1', true,
    { userId: { ...text(256), pattern: '^ou_[A-Za-z0-9_-]+$' }, text: text(12000), uuid }, ['userId', 'text']],
];

function freeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
  return Object.freeze(value);
}

export const TOOL_DEFINITIONS = freeze(definitions.map(([name, description, write, properties, required]) => ({
  name,
  description: `${description}\uff1b\u4f7f\u7528\u5f53\u524d\u6388\u6743\u7528\u6237\uff0c\u7531\u5bbf\u4e3b\u7ba1\u7406\u6388\u6743\u548c\u786e\u8ba4\u3002`,
  inputSchema: { type: 'object', properties, required, additionalProperties: false },
  annotations: { readOnlyHint: !write, destructiveHint: false, openWorldHint: true },
})));

function invalid(code = 'INVALID_ARGUMENTS') {
  throw Object.assign(new Error(code), { code });
}

function xml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;').replace(/\r\n?|\n/g, '<br/>');
}

// Pure validation, not authorization. Hosts must approve the original arguments before run().
// Returns logical flag/value pairs; createCli.run binds them as --flag=value before spawn.
export function validateTool(name, args) {
  const definition = TOOL_DEFINITIONS.find((tool) => tool.name === name);
  if (!definition) invalid('UNKNOWN_TOOL');
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(args))) invalid();
  const { properties, required } = definition.inputSchema;
  if (required.some((key) => !Object.hasOwn(args, key))) invalid();
  for (const key of Reflect.ownKeys(args)) {
    if (!Object.hasOwn(properties, key)) invalid();
    const descriptor = Object.getOwnPropertyDescriptor(args, key);
    if (!Object.hasOwn(descriptor, 'value')) invalid();
    const value = descriptor.value;
    const rule = properties[key];
    if (typeof value !== 'string' || !value.trim() || value.length > rule.maxLength ||
        /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value) || !value.isWellFormed() ||
        (rule.pattern && !new RegExp(rule.pattern).test(value))) invalid();
  }
  if (Object.hasOwn(args, 'start')) {
    // Date.parse normalizes impossible dates; verify the calendar portion separately.
    for (const value of [args.start, args.end]) {
      const day = value.slice(0, 10);
      if (!Number.isFinite(Date.parse(value)) ||
          new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day ||
          Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59) invalid();
    }
    const span = Date.parse(args.end) - Date.parse(args.start);
    if (span <= 0 || span > 40 * 86400000) invalid();
  }
  let argv;
  switch (name) {
    case 'feishu_document_read':
      argv = ['docs', '+fetch', '--doc', args.documentId, '--doc-format', 'markdown'];
      break;
    case 'feishu_document_create':
      argv = ['docs', '+create', '--doc-format', 'xml', '--content',
        `<title>${xml(args.title)}</title><p>${xml(args.text)}</p>`];
      break;
    case 'feishu_calendar_list':
      argv = ['calendar', '+agenda', '--calendar-id', args.calendarId, '--start', args.start, '--end', args.end];
      break;
    case 'feishu_calendar_event_create':
      argv = ['calendar', '+create', '--calendar-id', args.calendarId, '--summary', args.summary,
        '--start', args.start, '--end', args.end];
      break;
    case 'feishu_user_send':
      argv = ['im', '+messages-send', '--user-id', args.userId, '--text', args.text];
      if (args.uuid !== undefined) argv.push('--idempotency-key', args.uuid);
      break;
  }
  argv.push('--as', 'user', '--format', 'json');
  return { args: argv, summary: definition.description, write: !definition.annotations.readOnlyHint };
}
