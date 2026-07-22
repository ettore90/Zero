#!/usr/bin/env node

import { getBaseUrl } from './shared/base-url.mjs';
import { httpJson } from './shared/http-json.mjs';
import { createReport } from './shared/report.mjs';


function parseSseEvents(raw) {
  const events = [];
  const blocks = String(raw || '').replace(/\r\n/g, '\n').split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split(/\n/);
    let eventName = 'message';
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length) {
      const dataText = dataLines.join('\n');
      let data = dataText;
      try { data = JSON.parse(dataText); } catch {}
      events.push({ event: eventName, data });
    }
  }
  return events;
}

function isExactModelMatch(resolvedModel, expectedModel) {
  return typeof resolvedModel === 'string' && typeof expectedModel === 'string' && resolvedModel === expectedModel;
}

export async function runApiSmoke() {
  const report = createReport('api-smoke');
  const baseUrl = getBaseUrl();
  const loginUrl = `${baseUrl}/api/auth/login`;
  const meUrl = `${baseUrl}/api/auth/me`;
  const logoutUrl = `${baseUrl}/api/auth/logout`;
  const username = 'ettore';

  report.add(`baseUrl=${baseUrl}`);
  report.add(`loginUrl=${loginUrl}`);
  report.add(`meUrl=${meUrl}`);
  report.add(`logoutUrl=${logoutUrl}`);


  const loginResponse = await httpJson(loginUrl, {
    method: 'POST',
    body: { username },
  });
  const loginStatus = loginResponse?.status;
  const loginJson = loginResponse?.json;
  const token = loginJson?.token || loginJson?.accessToken || loginJson?.data?.token || loginJson?.data?.accessToken;

  report.add(`loginStatus=${loginStatus}`);
  report.add(`loginJson=${loginJson ? 'ok' : 'missing'}`);
  report.add(`token=${token ? 'present' : 'missing'}`);

  if (loginStatus !== 200) {
    throw new Error(`Expected login status 200, received ${loginStatus}`);
  }

  if (!token) {
    throw new Error('Login response did not include a token');
  }

  const meResponse = await httpJson(meUrl, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  const meStatus = meResponse?.status;
  const meJson = meResponse?.json;
  const meUsername = meJson?.username || meJson?.user?.username || meJson?.data?.username || meJson?.data?.user?.username;

  report.add(`meStatus=${meStatus}`);
  report.add(`meJson=${meJson ? 'ok' : 'missing'}`);
  report.add(`meUsername=${meUsername || 'missing'}`);

  if (meStatus !== 200) {
    throw new Error(`Expected authenticated me status 200, received ${meStatus}`);
  }

  if (!meJson) {
    throw new Error('Authenticated /api/auth/me response body is missing');
  }

  if (meUsername !== username) {
    throw new Error(`Expected authenticated username ${username}, received ${meUsername || 'missing'}`);
  }

  const stateUrl = `${baseUrl}/api/state/ettore`;
  report.add(`stateUrl=${stateUrl}`);

  const stateResponse = await httpJson(stateUrl, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  const stateStatus = stateResponse?.status;
  const stateJson = stateResponse?.json;
  const modelConfigs = Array.isArray(stateJson?.modelConfigs) ? stateJson.modelConfigs : null;
  const modelNames = Array.isArray(modelConfigs)
    ? modelConfigs
        .map((model) => model?.modelId || model?.name || model?.id)
        .filter((id) => typeof id === 'string' && id.length > 0)
    : [];
  const expectedModels = ['gpt-5.4-LAB', 'gpt-5.4-mini-qa'];
  const presence = Object.fromEntries(
    expectedModels.map((modelName) => [modelName, modelNames.includes(modelName)])
  );

  report.add(`stateStatus=${stateStatus}`);
  report.add(`modelConfigsCount=${modelNames.length}`);
  report.add(`modelNames=${modelNames.join(',') || 'none'}`);
  report.add(`has_gpt-5.4-LAB=${presence['gpt-5.4-LAB']}`);
  report.add(`has_gpt-5.4-mini-qa=${presence['gpt-5.4-mini-qa']}`);

  if (stateStatus !== 200) {
    throw new Error(`Expected state status 200, received ${stateStatus}`);
  }

  if (!Array.isArray(modelConfigs)) {
    throw new Error('Unexpected /api/state/ettore schema: expected json.modelConfigs array');
  }

  if (!presence['gpt-5.4-LAB']) {
    throw new Error(`Model gpt-5.4-LAB is not present in /api/state/ettore response; extracted=[${modelNames.join(', ')}]`);
  }

  if (!presence['gpt-5.4-mini-qa']) {
    throw new Error(`Model gpt-5.4-mini-qa is not present in /api/state/ettore response; extracted=[${modelNames.join(', ')}]`);
  }

  const chatUrl = `${baseUrl}/api/chat`;
  const agentId = 'mpkgkwbbynk8x18mqcg';
  const requestedModels = ['gpt-5.4-LAB', 'gpt-5.4-mini-qa'];
  const modelSmoke = [];

  for (const model of requestedModels) {
    const response = await fetch(chatUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        agentId,
        sessionId: `smoke-${model}-${Date.now()}`,
        newMessage: 'Responda apenas com OK.',
        model,
      }),
    });

    const raw = await response.text();
    const events = parseSseEvents(raw);
    const errorEvent = events.find((event) => event.event === 'error');
    const doneEvent = events.find((event) => event.event === 'done');
    const done = doneEvent?.data || {};
    const resolvedModel = done?.model || '';
    const content = typeof done?.content === 'string' ? done.content : '';
    const responseLength = content.length;
    const responsePreview = content.slice(0, 80);

    modelSmoke.push({ requestedModel: model, resolvedModel, responseLength, responsePreview });

    report.add(`chat:${model}:status=${response.status}`);
    report.add(`chat:${model}:error=${errorEvent ? 'present' : 'absent'}`);
    report.add(`chat:${model}:done=${doneEvent ? 'present' : 'absent'}`);
    report.add(`chat:${model}:resolvedModel=${resolvedModel || 'missing'}`);
    report.add(`chat:${model}:responseLength=${responseLength}`);
    report.add(`chat:${model}:responsePreview=${responsePreview || 'empty'}`);

    if (response.status !== 200) {
      throw new Error(`Expected /api/chat status 200 for ${model}, received ${response.status}`);
    }
    if (errorEvent) {
      throw new Error(`Unexpected error event for ${model}`);
    }
    if (!doneEvent) {
      throw new Error(`Missing done event for ${model}`);
    }
    if (!content) {
      throw new Error(`Empty done.content for ${model}`);
    }
    if (!isExactModelMatch(resolvedModel, model)) {
      throw new Error(`Resolved model ${resolvedModel || 'missing'} does not match requested ${model}`);
    }
  }

  const terminalResponse = await fetch(chatUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      agentId,
      sessionId: `smoke-terminal-${Date.now()}`,
      newMessage: 'Use a ferramenta run_terminal_command para executar pwd e informe a saída.',
      model: 'gpt-5.4-LAB',
    }),
  });

  const terminalRaw = await terminalResponse.text();
  const terminalEvents = parseSseEvents(terminalRaw);
  const terminalErrorEvent = terminalEvents.find((event) => event.event === 'error');
  const terminalToolCallEvent = terminalEvents.find((event) => event.event === 'tool_call');
  const terminalToolResultEvent = terminalEvents.find((event) => event.event === 'tool_result');
  const terminalDoneEvent = terminalEvents.find((event) => event.event === 'done');
  const terminalToolCall = terminalToolCallEvent?.data || {};
  const terminalToolResult = terminalToolResultEvent?.data || {};
  const terminalDone = terminalDoneEvent?.data || {};
  const terminalOutput = terminalToolResult?.output || {};
  const terminalContent = typeof terminalDone?.content === 'string' ? terminalDone.content : '';
  const terminalToolSummary = Array.isArray(terminalDone?.toolSummary) ? terminalDone.toolSummary : [];
  const terminalSummaryToolName = terminalToolSummary[0]?.toolName || '';

  report.add(`chat:terminal:status=${terminalResponse.status}`);
  report.add(`chat:terminal:error=${terminalErrorEvent ? 'present' : 'absent'}`);
  report.add(`chat:terminal:toolCall=${terminalToolCallEvent ? 'present' : 'absent'}`);
  report.add(`chat:terminal:toolName=${terminalToolCall.toolName || 'missing'}`);
  report.add(`chat:terminal:toolResult=${terminalToolResultEvent ? 'present' : 'absent'}`);
  report.add(`chat:terminal:exitCode=${terminalOutput.exitCode ?? 'missing'}`);
  report.add(`chat:terminal:output=${typeof terminalOutput.output === 'string' ? terminalOutput.output : 'missing'}`);
  report.add(`chat:terminal:done=${terminalDoneEvent ? 'present' : 'absent'}`);
  report.add(`chat:terminal:toolSummaryToolName=${terminalSummaryToolName || 'missing'}`);
  report.add(`chat:terminal:content=${terminalContent || 'empty'}`);

  if (terminalResponse.status !== 200) {
    throw new Error(`Expected /api/chat status 200 for terminal smoke, received ${terminalResponse.status}`);
  }
  if (terminalErrorEvent) {
    throw new Error('Unexpected error event for terminal smoke');
  }
  if (!terminalToolCallEvent || terminalToolCall.toolName !== 'run_terminal_command') {
    throw new Error(`Expected tool_call for run_terminal_command, received ${terminalToolCall.toolName || 'missing'}`);
  }
  if (!terminalToolResultEvent || terminalOutput?.exitCode !== 0) {
    throw new Error(`Expected tool_result exitCode 0, received ${terminalOutput?.exitCode ?? 'missing'}`);
  }
  if (typeof terminalOutput.output !== 'string' || terminalOutput.output.trim().length === 0) {
    throw new Error('Expected non-empty string output in terminal tool_result');
  }
  if (!terminalDoneEvent) {
    throw new Error('Missing done event for terminal smoke');
  }
  if (!Array.isArray(terminalDone.toolSummary) || terminalSummaryToolName !== 'run_terminal_command') {
    throw new Error('Expected done.toolSummary[0].toolName to be run_terminal_command');
  }
  if (!terminalContent || !terminalContent.includes('/')) {
    throw new Error(`Expected terminal done.content to include '/', received ${terminalContent || 'empty'}`);
  }

  const logoutResponse = await httpJson(logoutUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  report.add(`logoutStatus=${logoutResponse?.status}`);

  if (logoutResponse?.status !== 200) {
    throw new Error(`Expected logout status 200, received ${logoutResponse?.status}`);
  }

  return {
    ok: true,
    baseUrl,
    loginUrl,
    meUrl,
    logoutUrl,
    loginStatus,
    meStatus,
    meJson,
    stateUrl,
    stateStatus,
    stateJson,
    modelsCount: modelNames.length,
    presence,
    report,
  };
}

async function main() {
  try {
    const result = await runApiSmoke();
    console.log(result.report.toString());
    process.exitCode = 0;
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

const isDirectExecution =
  typeof process !== 'undefined' &&
  process.argv?.[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isDirectExecution) {
  main();
}
