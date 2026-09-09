import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_DEFINITIONS, validateTool } from './tools.mjs';

const calendar = { calendarId: 'feishu.cn_abc@group.calendar.feishu.cn',
  start: '2026-09-07T09:00:00+08:00', end: '2026-09-07T10:00:00+08:00' };

test('five immutable schemas with explicit user identity and host confirmation', () => {
  assert.equal(TOOL_DEFINITIONS.length, 5);
  for (const tool of TOOL_DEFINITIONS) {
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.ok(Object.isFrozen(tool.inputSchema.properties));
  }
  assert.throws(() => { TOOL_DEFINITIONS[0].name = 'exec'; });
});

test('exact tagged argv for document read and plain-text XML create', () => {
  assert.deepEqual(validateTool('feishu_document_read', { documentId: 'doc123' }), {
    args: ['docs', '+fetch', '--doc', 'doc123', '--doc-format', 'markdown', '--as', 'user', '--format', 'json'],
    summary: TOOL_DEFINITIONS[0].description, write: false,
  });
  const result = validateTool('feishu_document_create', {
    title: 'A & B', text: '@./secret\n<img href="https://example.com/x"/>',
  });
  assert.deepEqual(result.args, ['docs', '+create', '--doc-format', 'xml', '--content',
    '<title>A &amp; B</title><p>@./secret<br/>&lt;img href=&quot;https://example.com/x&quot;/&gt;</p>',
    '--as', 'user', '--format', 'json']);
  assert.equal(result.write, true);
});

test('exact tagged argv for agenda, event creation and user send', () => {
  assert.deepEqual(validateTool('feishu_calendar_list', calendar).args,
    ['calendar', '+agenda', '--calendar-id', calendar.calendarId, '--start', calendar.start,
      '--end', calendar.end, '--as', 'user', '--format', 'json']);
  assert.deepEqual(validateTool('feishu_calendar_event_create', { ...calendar, summary: 'Review' }).args,
    ['calendar', '+create', '--calendar-id', calendar.calendarId, '--summary', 'Review',
      '--start', calendar.start, '--end', calendar.end, '--as', 'user', '--format', 'json']);
  const result = validateTool('feishu_user_send', { userId: 'ou_123', text: '--yes; $(whoami)', uuid: 'key_1' });
  assert.deepEqual(result.args, ['im', '+messages-send', '--user-id', 'ou_123', '--text',
    '--yes; $(whoami)', '--idempotency-key', 'key_1', '--as', 'user', '--format', 'json']);
  assert.equal(result.write, true);
});

test('reject unknown tools, extra fields, inherited data, getters, malformed strings and paths', () => {
  assert.throws(() => validateTool('exec', {}), { code: 'UNKNOWN_TOOL' });
  for (const args of [null, [], 'doc123', {}, { documentId: '' }, { documentId: ' ' },
    { documentId: '@./secret' }, { documentId: '../secret' }, { documentId: 'https://example.com/doc' },
    { documentId: '--yes' , as: 'bot' }, { documentId: 'doc', command: 'logout' },
    Object.create({ documentId: 'doc' }), JSON.parse('{"documentId":"doc","__proto__":{}}'),
    { get documentId() { throw new Error('getter should never run'); } },
    { documentId: 'doc', [Symbol('x')]: true }, { documentId: 'doc\0x' },
    { documentId: 'a'.repeat(257) }]) {
    assert.throws(() => validateTool('feishu_document_read', args), { code: 'INVALID_ARGUMENTS' });
  }
  for (const text of ['', 'x\0y', '\ud800', 'a'.repeat(12001)]) {
    assert.throws(() => validateTool('feishu_user_send', { userId: 'ou_x', text }), { code: 'INVALID_ARGUMENTS' });
  }
  assert.throws(() => validateTool('feishu_user_send', { userId: 'oc_chat', text: 'x' }));
  assert.throws(() => validateTool('feishu_user_send', { userId: 'ou_x', text: 'x', uuid: 'a'.repeat(51) }));
});

test('calendar requires real dates, explicit timezone, ordered bounded range', () => {
  for (const start of ['2026-02-30T09:00:00Z', '2026-09-07T09:00:00',
    '2026-09-07', '2026-09-07T24:00:00Z', '2026-13-01T09:00Z',
    '2026-09-07T09:00:00+25:00', calendar.end]) {
    assert.throws(() => validateTool('feishu_calendar_list', { ...calendar, start }), { code: 'INVALID_ARGUMENTS' });
  }
  assert.throws(() => validateTool('feishu_calendar_list', { ...calendar, end: '2027-01-01T00:00:00Z' }));
  assert.throws(() => validateTool('feishu_calendar_event_create', { ...calendar, summary: 'x', description: '@file' }));
});
