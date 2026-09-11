const candidateKeys = new Set([
  'blockId', 'blockVersionId', 'content', 'contentHash', 'blockType', 'position',
  'included', 'packageStatus', 'selection'
]);
const contextKeys = new Set(['agentType', 'sessionId', 'taskTags', 'capabilities']);
const budgetKeys = new Set(['maxChars']);
const selectionKeys = new Set([
  'agentTypes', 'requiredCapabilities', 'anyCapabilities', 'sessionIds', 'taskTags',
  'excludeAgentTypes', 'excludeSessionIds', 'excludeTaskTags', 'priority',
  'forceInclude', 'forcedPosition'
]);

function fail(message) {
  throw new TypeError(`Invalid prompt block selector input: ${message}`);
}

function object(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object`);
  return value;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function ownValue(value, key) {
  return hasOwn(value, key) ? value[key] : undefined;
}

function keysAllowed(value, allowed, name) {
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || typeof key === 'symbol' || !allowed.has(key)) fail(`${name}.${String(key)} is not allowed`);
  }
}

function nonEmptyString(value, name) {
  if (typeof value !== 'string' || value.length === 0) fail(`${name} must be a non-empty string`);
  return value;
}

function integer(value, name) {
  if (!Number.isInteger(value)) fail(`${name} must be an integer`);
  return value;
}

function stringList(value, name) {
  if (!Array.isArray(value) || value.length === 0) fail(`${name} must be a non-empty array`);
  const seen = new Set();
  return value.map((item, index) => {
    const string = nonEmptyString(item, `${name}[${index}]`);
    if (seen.has(string)) fail(`${name} must not contain duplicates`);
    seen.add(string);
    return string;
  });
}

function optionalStringList(value, name) {
  return value === undefined ? undefined : stringList(value, name);
}

function hasOverlap(left, right) {
  return left.some((value) => right.includes(value));
}

function validateContext(value) {
  if (value === undefined) return { taskTags: [], capabilities: [] };
  object(value, 'context');
  keysAllowed(value, contextKeys, 'context');
  const agentType = ownValue(value, 'agentType');
  const sessionId = ownValue(value, 'sessionId');
  const taskTags = ownValue(value, 'taskTags');
  const capabilities = ownValue(value, 'capabilities');
  return {
    agentType: agentType === undefined ? undefined : nonEmptyString(agentType, 'context.agentType'),
    sessionId: sessionId === undefined ? undefined : nonEmptyString(sessionId, 'context.sessionId'),
    taskTags: taskTags === undefined ? [] : stringList(taskTags, 'context.taskTags'),
    capabilities: capabilities === undefined ? [] : stringList(capabilities, 'context.capabilities')
  };
}

function validateSelection(value, name) {
  if (value === undefined) return { priority: 0, forceInclude: false, forcedPosition: undefined };
  object(value, name);
  keysAllowed(value, selectionKeys, name);
  const selection = {
    agentTypes: optionalStringList(ownValue(value, 'agentTypes'), `${name}.agentTypes`),
    requiredCapabilities: optionalStringList(ownValue(value, 'requiredCapabilities'), `${name}.requiredCapabilities`),
    anyCapabilities: optionalStringList(ownValue(value, 'anyCapabilities'), `${name}.anyCapabilities`),
    sessionIds: optionalStringList(ownValue(value, 'sessionIds'), `${name}.sessionIds`),
    taskTags: optionalStringList(ownValue(value, 'taskTags'), `${name}.taskTags`),
    excludeAgentTypes: optionalStringList(ownValue(value, 'excludeAgentTypes'), `${name}.excludeAgentTypes`),
    excludeSessionIds: optionalStringList(ownValue(value, 'excludeSessionIds'), `${name}.excludeSessionIds`),
    excludeTaskTags: optionalStringList(ownValue(value, 'excludeTaskTags'), `${name}.excludeTaskTags`),
    priority: ownValue(value, 'priority') === undefined ? 0 : integer(ownValue(value, 'priority'), `${name}.priority`),
    forceInclude: ownValue(value, 'forceInclude') === undefined ? false : ownValue(value, 'forceInclude'),
    forcedPosition: ownValue(value, 'forcedPosition') === undefined ? undefined : integer(ownValue(value, 'forcedPosition'), `${name}.forcedPosition`)
  };
  if (typeof selection.forceInclude !== 'boolean') fail(`${name}.forceInclude must be a boolean`);
  if (selection.forcedPosition !== undefined && selection.forcedPosition < 0) fail(`${name}.forcedPosition must be non-negative`);
  if (selection.forcedPosition !== undefined && !selection.forceInclude) fail(`${name}.forcedPosition requires forceInclude`);
  return selection;
}

function exclusionCode(candidate, context) {
  const { selection } = candidate;
  if (!candidate.included) return 'not_included';
  if (candidate.packageStatus !== undefined && candidate.packageStatus !== null && candidate.packageStatus !== 'active') return 'package_not_active';
  if (selection.excludeAgentTypes?.includes(context.agentType)) return 'excluded_agent_type';
  if (selection.excludeSessionIds?.includes(context.sessionId)) return 'excluded_session';
  if (selection.excludeTaskTags && hasOverlap(selection.excludeTaskTags, context.taskTags)) return 'excluded_task_tag';
  if (selection.agentTypes && !selection.agentTypes.includes(context.agentType)) return 'agent_type_mismatch';
  if (selection.sessionIds && !selection.sessionIds.includes(context.sessionId)) return 'session_mismatch';
  if (selection.taskTags && !hasOverlap(selection.taskTags, context.taskTags)) return 'task_tag_mismatch';
  if (selection.requiredCapabilities && !selection.requiredCapabilities.every((item) => context.capabilities.includes(item))) return 'missing_required_capability';
  if (selection.anyCapabilities && !hasOverlap(selection.anyCapabilities, context.capabilities)) return 'missing_any_capability';
  return undefined;
}

function baseOrder(left, right) {
  return left.position - right.position || left.blockId.localeCompare(right.blockId);
}

export function selectPromptBlocks(input) {
  object(input, 'input');
  keysAllowed(input, new Set(['candidates', 'context', 'budget']), 'input');
  if (!hasOwn(input, 'candidates') || !Array.isArray(input.candidates)) fail('candidates must be an array');
  const context = validateContext(ownValue(input, 'context'));
  const budget = ownValue(input, 'budget');
  let budgetMaxChars = null;
  if (budget !== undefined) {
    object(budget, 'budget');
    keysAllowed(budget, budgetKeys, 'budget');
    const maxChars = ownValue(budget, 'maxChars');
    if (maxChars !== undefined && maxChars !== null) {
      budgetMaxChars = integer(maxChars, 'budget.maxChars');
      if (budgetMaxChars < 0) fail('budget.maxChars must be non-negative');
    }
  }

  const ids = new Set();
  const candidates = input.candidates.map((value, index) => {
    object(value, `candidates[${index}]`);
    keysAllowed(value, candidateKeys, `candidates[${index}]`);
    for (const key of ['blockId', 'content']) {
      if (!hasOwn(value, key)) fail(`candidates[${index}].${key} must be an own property`);
      nonEmptyString(value[key], `candidates[${index}].${key}`);
    }
    const blockVersionId = ownValue(value, 'blockVersionId');
    const contentHash = ownValue(value, 'contentHash');
    const blockType = ownValue(value, 'blockType');
    const included = ownValue(value, 'included');
    const packageStatus = ownValue(value, 'packageStatus');
    const position = ownValue(value, 'position');
    for (const [key, field] of [['blockVersionId', blockVersionId], ['contentHash', contentHash], ['blockType', blockType]]) {
      if (field !== undefined && field !== null) nonEmptyString(field, `candidates[${index}].${key}`);
    }
    if (ids.has(value.blockId)) fail('candidates must not contain duplicate blockId values');
    ids.add(value.blockId);
    if (included !== undefined && typeof included !== 'boolean') fail(`candidates[${index}].included must be a boolean`);
    if (packageStatus !== undefined && packageStatus !== null && !['active', 'staged', 'disabled', 'superseded'].includes(packageStatus)) fail(`candidates[${index}].packageStatus is invalid`);
    if (position !== undefined && integer(position, `candidates[${index}].position`) < 0) fail(`candidates[${index}].position must be non-negative`);
    return {
      blockId: value.blockId, blockVersionId, content: value.content, contentHash, blockType,
      position: position === undefined ? 0 : integer(position, `candidates[${index}].position`),
      included: included === undefined ? true : included,
      packageStatus,
      selection: validateSelection(ownValue(value, 'selection'), `candidates[${index}].selection`),
      estimatedChars: value.content.length
    };
  });

  const selected = [];
  const excluded = [];
  const eligible = [];
  for (const candidate of candidates) {
    const code = exclusionCode(candidate, context);
    if (code) excluded.push({ blockId: candidate.blockId, blockVersionId: candidate.blockVersionId, code, estimatedChars: candidate.estimatedChars });
    else eligible.push(candidate);
  }
  const forced = eligible.filter((item) => item.selection.forceInclude);
  const regular = eligible.filter((item) => !item.selection.forceInclude)
    .sort((left, right) => right.selection.priority - left.selection.priority || baseOrder(left, right));
  selected.push(...forced);
  let regularChars = 0;
  for (const candidate of regular) {
    if (budgetMaxChars === null || regularChars + candidate.estimatedChars <= budgetMaxChars) {
      selected.push(candidate);
      regularChars += candidate.estimatedChars;
    } else {
      excluded.push({ blockId: candidate.blockId, blockVersionId: candidate.blockVersionId, code: 'budget_exceeded', estimatedChars: candidate.estimatedChars });
    }
  }
  selected.sort((left, right) => {
    const leftForcedPosition = left.selection.forceInclude ? left.selection.forcedPosition : undefined;
    const rightForcedPosition = right.selection.forceInclude ? right.selection.forcedPosition : undefined;
    if (leftForcedPosition !== undefined || rightForcedPosition !== undefined) {
      if (leftForcedPosition === undefined) return 1;
      if (rightForcedPosition === undefined) return -1;
      if (leftForcedPosition !== rightForcedPosition) return leftForcedPosition - rightForcedPosition;
    }
    return baseOrder(left, right);
  });
  const output = selected.map((candidate) => ({
    blockId: candidate.blockId, blockVersionId: candidate.blockVersionId, content: candidate.content,
    contentHash: candidate.contentHash, blockType: candidate.blockType, position: candidate.position,
    priority: candidate.selection.priority, forceInclude: candidate.selection.forceInclude,
    forcedPosition: candidate.selection.forcedPosition, estimatedChars: candidate.estimatedChars
  }));
  return {
    selected: output,
    excluded,
    summary: {
      candidateCount: candidates.length, selectedCount: output.length, excludedCount: excluded.length,
      selectedChars: output.reduce((total, candidate) => total + candidate.estimatedChars, 0), budgetMaxChars
    }
  };
}
